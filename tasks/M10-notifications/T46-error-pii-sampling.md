# T46 — 错误聚合 PII 脱敏与采样配置

- **里程碑**：M10
- **优先级**：P1
- **前置依赖**：T15
- **预估工时**：5 h
- **状态**：Todo

## 目标

为每个站点配置脱敏正则与采样率：站点端 SDK 上报错误时，服务端按规则脱敏 stack / context 中的 PII（password、token、cookie 等），并按比例抛弃以防恶意刷流。

## 范围

**包含**

- 新表 `error_configs`：
  ```sql
  CREATE TABLE error_configs (
    site_id        UUID PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
    sample_rate    NUMERIC(4,3) NOT NULL DEFAULT 1.000,   -- 0.000–1.000
    drop_patterns  TEXT[] NOT NULL DEFAULT '{}',          -- 正则列表，case-insensitive
    redact_keys    TEXT[] NOT NULL DEFAULT '{password,token,cookie,authorization,secret,apikey}',
    max_payload_kb INT NOT NULL DEFAULT 32,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- service：`errorConfigService.getOrDefault(siteId)`、`update(siteId, patch)`
- 改造 `POST /api/v1/errors`（站点端 SDK 入口）：
  - 读取 site 的 config（带 cache）
  - 按 sample_rate 随机丢弃
  - stack / context 字符串先按 drop_patterns 整体丢弃（命中即整条不入库），再按 redact_keys 替换值为 `[REDACTED]`
  - 超 max_payload_kb 直接 413
- UI：`/(dashboard)/sites/[id]/settings` 加 "错误聚合" 卡片，编辑 sample_rate / drop_patterns / redact_keys

**不包含**

- IP 黑名单（rate-limit 已覆盖）
- 重写 SDK（脱敏发生在服务端，SDK 不变）

## 设计要点

### 脱敏算法

```ts
// services/src/errors/redact.ts
export function applyRedaction(
  obj: unknown,
  cfg: { dropPatterns: RegExp[]; redactKeys: Set<string> },
): { dropped: boolean; value: unknown } {
  if (typeof obj === 'string') {
    for (const re of cfg.dropPatterns) if (re.test(obj)) return { dropped: true, value: null };
    return { dropped: false, value: obj };
  }
  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    for (const v of obj) {
      const r = applyRedaction(v, cfg);
      if (r.dropped) return { dropped: true, value: null };
      out.push(r.value);
    }
    return { dropped: false, value: out };
  }
  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (cfg.redactKeys.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
        continue;
      }
      const r = applyRedaction(v, cfg);
      if (r.dropped) return { dropped: true, value: null };
      out[k] = r.value;
    }
    return { dropped: false, value: out };
  }
  return { dropped: false, value: obj };
}
```

### Sampling

```ts
// route.ts
if (Math.random() >= cfg.sampleRate) {
  return ok({ accepted: false, reason: 'sampled_out' }, { status: 202 });
}
```

- 必须先抽样、后脱敏，避免脱敏后白做工
- 抽样命中也返回 202（SDK 不需要重试）

### Cache

- siteId → config 进程内 LRU 60s
- 任何 update 后通过 service 主动 invalidate

## 涉及文件

```
packages/db/migrations/00XX_error_configs.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/error-configs.ts
packages/db/src/schema/index.ts
packages/db/src/repositories/error-config-repo.ts
packages/services/src/errors/error-config-service.ts
packages/services/src/errors/redact.ts
packages/services/src/errors/__tests__/redact.test.ts
packages/shared/src/schemas/error-configs.ts
apps/web/app/api/v1/errors/route.ts                       # 改 POST 加 sampling+redact
apps/web/app/api/v1/sites/[id]/error-config/route.ts      # GET / PATCH
apps/web/app/(dashboard)/sites/[id]/settings/page.tsx     # 加卡片
```

## 验收标准

- [ ] 迁移 apply 成功
- [ ] 单测：drop_patterns 命中字符串整条丢弃
- [ ] 单测：redact_keys 把对象内值替换为 [REDACTED]
- [ ] 单测：嵌套对象与数组完整脱敏
- [ ] 单测：sample_rate=0.1 时 1000 次上报 ≈ 100 ± 30 次入库
- [ ] 路由：缺 site_id 仍返回 400；存在但无 config → 用 default
- [ ] UI 可在站点 settings 中保存配置并立即生效（cache 失效）
- [ ] `pnpm -r typecheck && lint && test` 全绿
