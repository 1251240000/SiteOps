# T43 — Webhook secret 旋转

- **里程碑**：M9
- **优先级**：P1
- **前置依赖**：T27
- **预估工时**：4 h
- **状态**：Todo

## 目标

把 CF / GitHub 等 webhook secret 从 env 单值改为 DB 双 secret 模式，支持滚动更新：rotate 后 7 天内新旧两个 secret 同时有效，避免上游切换造成短暂全部失败。

## 范围

**包含**

- 新表 `webhook_secrets`：
  ```sql
  CREATE TABLE webhook_secrets (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider       TEXT NOT NULL,              -- 'cloudflare' | 'github'
    secret_hash    TEXT NOT NULL,              -- bcrypt(secret)
    active         BOOLEAN NOT NULL DEFAULT true,
    rotated_at     TIMESTAMPTZ,
    expires_at     TIMESTAMPTZ,                -- rotate 后旧 secret 的失效时间
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX webhook_secrets_provider_idx ON webhook_secrets (provider, active);
  ```
- service：`webhookSecretService.list(provider) / create / rotate / revoke`
- 改造 `verifyAndIngest`：对每个 provider 取所有 active 且未过期的 secret，逐个 HMAC 验证，命中任一即通过
- env fallback：如果 DB 无任何 active secret，回退读 env `CF_WEBHOOK_SECRET` / `GH_WEBHOOK_SECRET`（保持向下兼容）
- UI：`/(dashboard)/settings/webhooks` — 列表 + rotate 按钮（rotate 时新 secret 一次性显示）
- 自动失效：scheduler 加一个 `webhook-secret-cleanup` 每天清 `expires_at < now()` 的旧 secret（标 active=false）

**不包含**

- 别的 provider secret（GA4 / GSC 用 OAuth refresh token，不在本任务）
- Audit log（T42 已覆盖）

## 设计要点

### Rotate 流程

```
admin 点 rotate 按钮
→ POST /api/v1/webhook-secrets/{provider}/rotate
   1. 把当前 active 行的 expires_at 设为 now() + 7 days（仍 active=true）
   2. INSERT 新 active secret
   3. 返回新 secret 明文（一次性）
→ UI 显示明文 + "请尽快在 CF/GH 配置端更新"
→ 7 天后 cleanup job 把旧 secret active=false
```

### Verify 改造

```ts
// webhook-service.ts.verifyAndIngest
async function verifySignature(provider: string, body: string, signature: string) {
  const dbSecrets = await webhookSecretRepo.listActive(provider);
  const envSecret = getProviderSecretFromEnv(provider);
  const candidates = [...dbSecrets.map((s) => s.plaintext), envSecret].filter(Boolean);
  if (candidates.length === 0) return { kind: 'not_configured' };
  for (const secret of candidates) {
    if (constantTimeEquals(hmac(secret, body), signature)) return { kind: 'ok' };
  }
  return { kind: 'unauthorized' };
}
```

- 注意：DB 存 hash 而非明文 → verify 需要明文 → 选择 1：DB 存 AES-加密（参考 T41 TOTP 加密方案）；选择 2：直接 DB 存明文（受 admin 权限保护）
- 推荐 **选择 1**（加密存）：env `WEBHOOK_SECRET_ENC_KEY`，所有 secret 都加密

## 涉及文件

```
packages/db/migrations/00XX_webhook_secrets.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/webhook-secrets.ts
packages/db/src/schema/index.ts
packages/db/src/repositories/webhook-secret-repo.ts
packages/services/src/webhooks/webhook-secret-service.ts
packages/services/src/webhooks/webhook-service.ts           # verifySignature 改造
apps/web/app/api/v1/webhook-secrets/route.ts                 # GET / POST
apps/web/app/api/v1/webhook-secrets/[provider]/rotate/route.ts
apps/web/app/(dashboard)/settings/webhooks/page.tsx          # UI
apps/web/lib/env.ts                                          # +WEBHOOK_SECRET_ENC_KEY
apps/worker/src/schedulers/webhook-secret-cleanup.ts         # 新
apps/worker/src/index.ts                                     # 注册
```

## 验收标准

- [ ] 迁移 apply 成功
- [ ] 单测：rotate 后 verify 旧 secret + 新 secret 都通过
- [ ] 单测：rotate 后 7 天，旧 secret expires_at 触发后 verify 失败
- [ ] 单测：DB 无 active secret 时回退到 env
- [ ] e2e：admin rotate CF webhook → 新 secret 显示 → 用旧 secret POST /hooks/cloudflare 仍 202
- [ ] cleanup 调度：手动跑后过期行被标 active=false
- [ ] `pnpm -r typecheck && lint && test` 全绿
