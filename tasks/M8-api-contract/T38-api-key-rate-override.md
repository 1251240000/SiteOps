# T38 — API Key 自定义限流 + system 端点

- **里程碑**：M8
- **优先级**：P1
- **前置依赖**：T06, T11
- **预估工时**：6 h
- **状态**：Done

## 目标

1. 在 `api_keys` 表加 `rate_limit_per_min` 列，让单个 key 可绕过全局默认；
2. 实现 spec §3.10 列出但未落地的 `/api/v1/system/version` 与 `/api/v1/system/jobs` 两个端点，方便巡检。

## 范围

**包含**

- 迁移：`packages/db/migrations/00XX_apikey_rate_limit.sql` —— `ADD COLUMN rate_limit_per_min INTEGER NULL`
- Drizzle schema + repo + service 同步
- 改造 `apps/web/lib/rate-limit.ts.checkApiKeyRateLimit`：优先读 key 自定义，否则回退到 env
- 设置页 `/(dashboard)/settings/api-keys`：新增 / 编辑表单显示 `rate_limit_per_min`（可选）
- 新增路由 `apps/web/app/api/v1/system/version/route.ts` + `/system/jobs/route.ts`
- `/system/jobs` 调 BullMQ `getJobCounts()` 汇总每个 queue 的 waiting/active/delayed/completed/failed

**不包含**

- 全局限流 token bucket 替换（spec §5 提到 Redis token bucket，本任务仍是滑动窗口 + per-key override）
- per-IP 限流（dashboard 已经是 session，跟 IP 没关系；API key 主用 key 维度）

## 设计要点

### Rate-limit 改造

```ts
// rate-limit.ts
export async function checkApiKeyRateLimit(apiKey: { id: string; rateLimitPerMin: number | null }) {
  const env = getEnv();
  const limit = apiKey.rateLimitPerMin ?? env.API_KEY_RATE_LIMIT_PER_MIN;
  return checkSlidingWindow(`apikey:rl:${apiKey.id}`, limit, { apiKeyId: apiKey.id });
}
```

- 注意：现在的 `withApiKey` 只传 `apiKeyId`；改成传 `AuthenticatedApiKey` 完整对象，把 `rateLimitPerMin` 也带过去（schema 加字段）
- `AuthenticatedApiKey` type 在 `auth-service.ts` 同步加 `rateLimitPerMin: number | null`

### `/system/version`

```ts
export const GET = withApi(async () => {
  return ok({
    version: process.env.npm_package_version ?? '0.0.0',
    gitSha: process.env.GIT_SHA ?? null,
    nodeVersion: process.version,
    startedAt: process.env.BOOTED_AT ?? null,
  });
});
```

- `BOOTED_AT` 在 `instrumentation.ts` 启动时写入（如未有 instrumentation 文件，新建）
- 单层缓存 30s 即可

### `/system/jobs`

```ts
import { getQueue, ALL_QUEUES } from '@siteops/worker-internals'; // 抽公共导出

export const GET = withApi(async (_req, ctx) => {
  const env = getEnv();
  const config = { redisUrl: env.REDIS_URL, logger: ctx.logger };
  const stats = await Promise.all(
    ALL_QUEUES.map(async (name) => {
      const q = getQueue(name, config);
      const counts = await q.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
      return { name, ...counts };
    }),
  );
  return ok(stats);
});
```

- 为了避免 web 进程持有 BullMQ producer，可以把 `getQueue` / `ALL_QUEUES` 抽到 `packages/services/src/queues.ts`（也用于 dashboard 监控未来）

## 涉及文件

```
packages/db/migrations/00XX_apikey_rate_limit.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/api-keys.ts
packages/db/src/repositories/api-key-repo.ts
packages/services/src/auth/auth-service.ts             # type 加 rateLimitPerMin
packages/services/src/auth/api-key-service.ts          # CRUD 接受 rate_limit_per_min
packages/shared/src/schemas/api-keys.ts                # Zod 加字段
apps/web/lib/rate-limit.ts                              # checkApiKeyRateLimit 改签名
apps/web/lib/with-api.ts                                # 调用方同步
apps/web/app/(dashboard)/settings/api-keys/page.tsx     # 表单加字段
apps/web/app/api/v1/system/version/route.ts             # 新
apps/web/app/api/v1/system/jobs/route.ts                # 新
apps/web/app/api/v1/system/__tests__/route.test.ts      # 新
packages/services/src/queues.ts                          # 抽 BullMQ 公共导出
apps/web/instrumentation.ts                              # 写 BOOTED_AT
docs/04-api-spec.md                                      # §5 / §3.10 状态更新
```

## 验收标准

- [x] 迁移 apply 成功；现有 row `rate_limit_per_min` 为 NULL
- [x] 后台改某个 key `rate_limit_per_min=60`，触发 61 次/分钟时第 61 次 429
- [x] 默认仍是 600/min（NULL 时回退到 env）
- [x] `curl /api/v1/system/version` 返回 version / gitSha / nodeVersion
- [x] `curl /api/v1/system/jobs` 返回每个 queue 的 5 项 counts
- [x] 路由权限：`/system/*` 仅 admin session 可访问
- [x] `pnpm -r typecheck && lint && test` 全绿

## 实施记录

### 落地差异 vs 原设计

- **`ALL_QUEUES` 抽取位置**：原设计提议放到 `packages/services/src/queues.ts`，
  实际放在 `apps/web/lib/queues.ts`（已有 BullMQ producer 句柄，避免把 ioredis
  传染到 services 层）。worker 侧 `apps/worker/src/queues.ts:ALL_QUEUES`
  作为 source of truth，两边需手动同步，文档 §3.10 已注明。
- **`/system/version` 30s 缓存**：未实现。该路由 admin-only、调用低频，加缓存收益
  不抵实现复杂度；保留作为后续优化。
- **PATCH 端点新增**：原任务未明确，但 UI 需要不重发 key 就调整限流，因此加了
  `PATCH /api/v1/settings/api-keys/{id}` + `updateApiKeySchema`，
  支持 `rateLimitPerMin: number | null`（`null` 清除覆盖）。
- **写路径同时清缓存**：`apiKeyService.updateRateLimit` 命中 `apiKeyCache.deleteById`
  ↔ 与 `revoke` 一致，保证当前进程立即看到新限流。多副本场景靠 LRU 自然过期。
- **`with-api.ts` 签名变更**：`checkApiKeyRateLimit` 现在收 `{ id, rateLimitPerMin }`
  而非裸 `apiKeyId`；两条 Bearer 分支（`withApiKey` / `withAuth`）都已更新。
- **审计/输入校验**：`createApiKeySchema` 与 `updateApiKeySchema` 都把
  `rateLimitPerMin` 限制为正整数且 ≤ 100000；空 body 的 PATCH 被
  `.refine` 拒绝（400 `validation_failed`）。

### 测试矩阵

- `packages/services/src/auth/__tests__/api-key-service.test.ts`
  新增 `apiKeyService.updateRateLimit` 子组：set / clear / 未知 id / revoked row。
- `apps/web/lib/__tests__/rate-limit.test.ts`
  覆盖 Redis 路径与 local-fallback 路径上的 per-key override 行为。
- `apps/web/lib/__tests__/with-api-rate-limit.test.ts`
  断言 `checkApiKeyRateLimit` 收到 `{ id, rateLimitPerMin }` 对象，
  seeded row 转发 `rateLimitPerMin: null`。
- `apps/web/app/api/v1/settings/api-keys/__tests__/route.test.ts`
  新增 6 条 PATCH 测试 + 2 条 POST 测试。
- `apps/web/app/api/v1/system/__tests__/route.test.ts`
  6 条用例覆盖两个 system 端点的 401 / 200 / 错误降级路径。
