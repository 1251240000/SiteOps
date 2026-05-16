# T27 — CF / GitHub webhook 接收

- **里程碑**：M5
- **优先级**：P2
- **前置依赖**：T17（Cloudflare service），T18（GitHub service）
- **预估工时**：6h
- **状态**：Todo

## 目标

把 T17 / T18 的"每小时 cron 拉部署"补上"事件驱动入库"——CF Pages 与 GitHub Actions 发完 webhook 几秒内 `deployments` 表就有新行。带签名校验、幂等去重、失败可重放。

## 范围

**包含**

- 新表 `webhook_events`（详见"数据模型"），用于：
  - HMAC 校验通过/失败的审计记录
  - delivery_id 级幂等（重复投递不重复处理）
  - 处理失败时保留 payload，供 admin 后续重放
- 迁移：`packages/db/migrations/0008_webhook_events.sql`（编号视 T25/T26 的合并顺序往后顺延）
- Drizzle schema：`packages/db/src/schema/webhook-events.ts`
- Repo：`packages/db/src/repositories/webhook-event-repo.ts`
  - `findByDelivery(provider, deliveryId)`, `create(input)`, `markProcessed(id)`, `markFailed(id, err)`, `list(filters)`, `reprocess(id)` (只是返回 row，让 service 重跑)
- service：`@siteops/services/src/webhooks/webhook-service.ts`
  - `verifyAndIngest(deps, { provider, headers, rawBody })` —— 校验 → 去重 → 调下游
  - `dispatchCloudflare(deps, payload)` —— 调 `deploymentService.create` 完成 upsert
  - `dispatchGitHub(deps, eventType, payload)` —— 同上；分 `workflow_run` / `push` / `deployment_status` 分支
  - `replay(deps, id)` —— 重新调度一条历史事件
- HMAC 工具：
  - `packages/shared/src/utils/hmac.ts`：`timingSafeEqualHex(a, b)`, `verifyHmacSha256(secret, rawBody, signatureHex)`
- 2 个 webhook 入口（文档 04-api-spec.md §4 已经登记的两条）：
  - `POST /api/v1/hooks/cloudflare` —— 头 `Cf-Webhook-Auth`（CF Notification Service 用的 HMAC-SHA256 hex）
  - `POST /api/v1/hooks/github` —— 头 `X-Hub-Signature-256: sha256=<hex>`，事件类型在 `X-GitHub-Event`，delivery id 在 `X-GitHub-Delivery`
- 1 个管理端点：
  - `POST /api/v1/hooks/{provider}/replay/{id}` —— admin 重放（仅 session）
- 配置：
  - 新增 env `CF_WEBHOOK_SECRET`, `GH_WEBHOOK_SECRET`（必填则 hook 启用；未填则该 provider 路由直接返回 503 `webhook_not_configured`）
  - 写进 `.env.example` + `docs/07-development-setup.md`
- 文档：在 `docs/04-api-spec.md` §4 末尾补一段"签名格式 + 重放策略"，避免 future-me 自己忘了

**不包含**

- 其它 provider（Vercel / Netlify / GitLab）—— 加一个 dispatch 分支即可，本任务先把脚手架打通
- Web UI 端的 webhook 列表（数据进表，UI 留 v2；admin 当下能用 `psql + curl /replay` 兜底）
- 重试调度（一次失败只标记 `failed`，靠 admin 主动 replay；做指数退避自动重试会让 webhook 通道延迟不可预期）
- 自动注册 webhook（CF/GitHub 那边的 webhook 需要 admin 手动配；平台不替用户调远端 API 去创建）

## 数据模型

### `webhook_events`

```sql
CREATE TABLE webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,                  -- 'cloudflare' | 'github'
  event_type      TEXT NOT NULL,                  -- 'workflow_run' | 'deployment.success' | ...
  delivery_id     TEXT NOT NULL,                  -- 'X-GitHub-Delivery' / CF 'cf-webhook-id'
  signature_ok    BOOLEAN NOT NULL,
  payload         JSONB NOT NULL,                 -- raw JSON body
  site_id         UUID REFERENCES sites(id) ON DELETE SET NULL,
  processed_at    TIMESTAMPTZ,                    -- 处理成功时间；NULL = 未处理 / 失败
  error           TEXT,
  attempts        SMALLINT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 同 provider + delivery_id 唯一：重复投递直接拦在入库前
CREATE UNIQUE INDEX webhook_events_delivery_uk
  ON webhook_events (provider, delivery_id);

CREATE INDEX webhook_events_provider_created_idx
  ON webhook_events (provider, created_at DESC);
CREATE INDEX webhook_events_unprocessed_idx
  ON webhook_events (provider, created_at)
  WHERE processed_at IS NULL;

ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_provider_check
  CHECK (provider IN ('cloudflare','github'));
```

### 字段约定

- `delivery_id` 是 provider 头部里的全局唯一字符串：
  - GitHub：`X-GitHub-Delivery`（UUID v4 形式）
  - Cloudflare：`cf-webhook-id`（CF Notification API 提供）
- `signature_ok=false` 也写入：用于审计可能的攻击或配置错误；这种行 `processed_at` 永远为 NULL。
- `site_id` 在 dispatch 阶段解析出来才回填（CF：用 `cf_pages_project` 反查 sites；GitHub：用 `repo_url` 反查）。

## API 行为

### 标准成功响应

webhook 端点要在签名通过 + 入库后立刻返回 2xx，给上游一个干净的 ack：

```http
POST /api/v1/hooks/github
HTTP/1.1 202 Accepted
{ "data": { "id": "<webhook_event uuid>", "duplicate": false } }
```

`duplicate: true` 时返回 200（已有的 row 直接 echo，不重复 dispatch）。

### 错误形态

- 签名缺失 / 校验失败 → 401 `unauthorized`（**注意：仍然写一行 `signature_ok=false` 入库**）
- 未配 secret → 503 `webhook_not_configured`
- 解析 payload 失败 → 400 `validation_failed`，**不入库**（payload 不可信）
- 下游 service 抛错 → 202 + `meta.dispatch_failed: true`：webhook 本身收到了，只是处理失败；admin 后续可 replay

这套语义对 webhook 通道最友好：上游不会因为我们的下游 bug 而走重试 → 通道堵塞。

### dispatch 映射

| Provider | event_type                 | 行为                                                                                                                            |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| CF       | `deployment.started`       | `deploymentService.upsert({ provider:'cloudflare_pages', status:'building' })`                                                  |
| CF       | `deployment.success`       | upsert status='success'，附 commit_sha / build_log_url                                                                          |
| CF       | `deployment.failure`       | upsert status='failed'                                                                                                          |
| GH       | `workflow_run.completed`   | conclusion=success → status='success'；否则 'failed'；provider 由 workflow 名识别（含 `pages` → `github_pages`，否则 `manual`） |
| GH       | `workflow_run.in_progress` | upsert status='building'                                                                                                        |
| GH       | `push`                     | 只入库，**不创建** deployment（push 不等于发布）                                                                                |
| GH       | `deployment_status`        | 转 deploymentService.upsert，state→status                                                                                       |

upsert 的 idempotency 已经由 T10 的 `(provider, provider_deployment_id)` unique index 保证；本任务只是事件源不同。

## 涉及文件

```
packages/shared/src/utils/hmac.ts
packages/shared/src/utils/hmac.test.ts
packages/shared/src/schemas/webhooks.ts                # cloudflare / github body 的 Zod 类型守卫

packages/db/src/schema/webhook-events.ts
packages/db/migrations/0008_webhook_events.sql         # 编号往后调整
packages/db/migrations/meta/_journal.json              # 追加
packages/db/src/repositories/webhook-event-repo.ts
packages/db/src/repositories/webhook-event-repo.test.ts
packages/db/src/repositories/index.ts                  # 导出
packages/db/src/schema/index.ts                        # 导出
packages/db/src/schema/__tests__/migrate.test.ts       # expected tables += 'webhook_events'

packages/services/src/webhooks/webhook-service.ts
packages/services/src/webhooks/webhook-service.test.ts
packages/services/src/webhooks/cloudflare-dispatch.ts
packages/services/src/webhooks/github-dispatch.ts
packages/services/src/webhooks/index.ts
packages/services/src/index.ts                         # 加 webhooks 命名空间

apps/web/lib/env.ts                                    # +CF_WEBHOOK_SECRET, +GH_WEBHOOK_SECRET (optional)
apps/web/app/api/v1/hooks/cloudflare/route.ts
apps/web/app/api/v1/hooks/github/route.ts
apps/web/app/api/v1/hooks/[provider]/replay/[id]/route.ts
apps/web/app/api/v1/hooks/__tests__/cloudflare.test.ts
apps/web/app/api/v1/hooks/__tests__/github.test.ts

.env.example                                           # 写进新 secret
docs/04-api-spec.md                                    # 末尾补"签名格式 + 重放"附录
docs/07-development-setup.md                           # 加"如何用 ngrok 在本地测 webhook"小段
```

## 设计要点

### 校验签名时不要先 JSON.parse

route handler 必须用 `await req.text()` 拿 **原始字符串**，HMAC 是对 raw body 算的；先 `req.json()` 之后再 `JSON.stringify` 算是不可逆的：CF/GH 的字节序、字段顺序、空格都会变。

```ts
// app/api/v1/hooks/github/route.ts
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get('x-hub-signature-256') ?? '';
  const delivery = req.headers.get('x-github-delivery') ?? '';
  const eventType = req.headers.get('x-github-event') ?? '';
  // ↓ 在 service 里：先校验签名，签名 ok 才 JSON.parse
  return webhookService.verifyAndIngest(deps, {
    provider: 'github',
    headers: { signature: sig, deliveryId: delivery, eventType },
    rawBody: raw,
  });
}
```

`Content-Type` 强制要 `application/json`；其它（如 `application/x-www-form-urlencoded`，GitHub 的旧选项）直接 415。

### 时序攻击防护

`hmac.ts` 必须用 `crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))`，不能用 `===`；长度不一致也走 fallback `timingSafeEqual` over 长度归一化的 buffer，避免「签名长度差异」侧信道。

### 幂等的两道闸

1. **入口幂等**：`(provider, delivery_id)` 在 `webhook_events` 上 unique；DB 抛 23505 时返回 `duplicate: true`，不调下游。
2. **业务幂等**：dispatch 阶段调 `deploymentService.create`，由 T10 的 `(provider, provider_deployment_id)` 二次保护（万一 delivery_id 被 provider 重生成）。

### `signature_ok=false` 也入库的理由

被攻击 / 配错时，能在 dashboard / `psql` 里立刻看见"过去一小时进来 50 条无效签名"。这是廉价的攻击侦测，不写就完全黑盒。

但要**限频**避免被刷爆：

- 同 provider + 同 IP，5 分钟内 `signature_ok=false` 超过 50 条 → 之后只 401 不写库（用内存计数即可，挂在 service 单例）。
- 不在 M5 范围里做完整 IP 限流，靠 nginx / Caddy 上层兜底。

### 错误日志体积

- payload 整段进 JSONB，CF 的 deployment.success 大概 2 KB，GH 的 workflow_run 大概 5–10 KB；100 站点 / 天 < 几 MB，无压力。
- 90 天后由 housekeeping 删除 `processed_at IS NOT NULL` 的旧 row（保留 `signature_ok=false` 不删，便于审计）。
- 这条 housekeeping rule 不在本任务范围；先实现，注释里标注 `// TODO(T27): wire housekeeping retention` 即可。

### `replay` 端点

```http
POST /api/v1/hooks/cloudflare/replay/<event_id>
Cookie: __Secure-...
```

- session-only（admin），不接受 API key（重放本质是修复历史，权限应当人控）
- 行为：从 `webhook_events` 读 row → 把 `payload` 重新喂回 dispatch path → `attempts += 1`，记录新的 `processed_at` / `error`
- 不重新校签名（payload 已落库认为可信）；UI 上要明确这是 admin 视角的"修复"

### 与 T17 / T18 cron 同步的关系

- cron 仍然保留，作为兜底（webhook 丢失、初次接入未配 secret 的情况下，每小时仍会拉到部署）。
- 由于 deployments 的 `(provider, provider_deployment_id)` unique，webhook 先写入还是 cron 先写入都不冲突，只是后者补"漏"。

### env 校验

`apps/web/lib/env.ts`：

```ts
CF_WEBHOOK_SECRET: z.string().min(16).optional(),
GH_WEBHOOK_SECRET: z.string().min(16).optional(),
```

未配的 provider 路由直接返回：

```json
{
  "error": {
    "code": "webhook_not_configured",
    "message": "CF webhook secret not set",
    "requestId": "..."
  }
}
```

HTTP 503。这样在初次接入时不会因为 missing secret 导致 5xx 噪声。

## 验收标准

- [ ] 迁移 `0008_webhook_events.sql` 在 fresh DB 上 apply 成功；`schema/__tests__/migrate.test.ts` 把 `'webhook_events'` 加入 expected list 并通过
- [ ] HMAC 工具单测：
  - 一致的 secret / body → ok
  - 错误 secret / 改一字节 body → fail
  - 不同长度签名 → fail（不抛异常）
- [ ] `webhookService.verifyAndIngest` 单测：
  - 合法 GH `workflow_run.completed`（success）→ `deployments` 出新行；`webhook_events.processed_at` 非空
  - 同 delivery_id 第二次投递 → 不重复入库、不重复 dispatch，返回 `duplicate=true`
  - 签名错 → 401 + `signature_ok=false` 行写入；不调 deploymentService
  - 下游 service 抛错 → 202 + `dispatch_failed=true`；webhook row `error` 字段有值
- [ ] 路由单测：
  - 未配 secret → 503 `webhook_not_configured`
  - `content-type: text/plain` → 415
  - `replay` 未登录 → 401；登录后能把失败 row 重新跑通
- [ ] 本地用 `pnpm dev` + `pnpm exec curl-mocked-webhook.sh`（或 ngrok）真实跑一次 GH webhook 成功
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿

## 备注

- CF 的官方 Notification webhook 头是 `cf-webhook-auth`（HMAC-SHA256 over body，hex）和 `cf-webhook-id`（delivery id）。如果接入的是 CF Pages 内置 deploy hook，则**没有签名**——这种情况只能依赖 https + path-secret。本任务默认走 Notification API；后续若接 deploy hook 单独开 T27.5。
- GitHub 的 webhook 可同时配置 `push`, `workflow_run`, `deployment_status` 等事件；运维侧建议只勾"Pull Requests"以外的部署相关事件，减少噪声。
- 重放路径仅用于"恢复 dispatch"——不会重发签名校验；不要把 replay 暴露给外部 API key。
- 真要做"实时把 alert 推给 admin 的 webhook 接收端"是另一类需求（站点 → 平台的告警上行通道），不在本任务范围。
