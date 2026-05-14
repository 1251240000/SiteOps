# T17 — Cloudflare 账号/项目/部署同步

- **里程碑**：M3
- **优先级**：P1
- **前置依赖**：T10
- **预估工时**：7h
- **状态**：Done

## 目标

接入 Cloudflare API，定时拉取每个站点关联 CF Pages 项目的部署历史与状态，写入 `deployments` 表（沿用 T10 service）。

## 范围

**包含**

- `@siteops/integrations/cloudflare`：
  - `CloudflareClient(accountId, apiToken)`：基础 client
  - `listPagesProjects(accountId)`：所有 Pages 项目
  - `listDeployments(accountId, projectName, since)`：增量获取部署
  - `getDeployment(accountId, projectName, deploymentId)`
  - `verifyToken()`：调用 `user/tokens/verify`
- worker job：`cf-sync`（每小时）
  - 遍历 sites 中 `cf_account_id` + `cf_pages_project` 非空的
  - 调 `listDeployments`，写入新部署（用 deploymentService.upsertByProviderId）
- API：
  - `POST /api/v1/integrations/cloudflare/test`（body: `{ apiToken }`）→ 调 verifyToken
  - `POST /api/v1/integrations/cloudflare/sync`（手动触发）
  - `GET /api/v1/integrations/cloudflare/projects?accountId=`（用于站点创建时下拉选择）
- UI：
  - `/(dashboard)/integrations`：CF 卡片，配置 token + 测试 + 上次同步时间
  - 站点 settings 内：CF account/project 选择器（调上方 list API）

**不包含**

- Workers 配置同步
- DNS 记录同步
- 自动创建 Pages 项目

## 设计要点

- token 存 DB 用 cipher（同 T16 的 cipher 工具）。存放位置：`api_keys` 表加 `provider, encrypted_token` 字段？不——新建 `integration_credentials` 子表？

  **决策**：为简化 MVP，把全局 integration token 存 `.env`（`CF_API_TOKEN` 等）；站点维度的 override 后续再做。MVP 仅 admin 单人，env 即够。

- 限流：CF API 1200 req/5min；本任务内并发限 5。
- 增量：用 `deployments.created_on` 时间戳 + 本地 `last_synced_at`（存 sites 表新增列 `cf_last_synced_at timestamptz` 或单独 integrations_state 表，本任务后者更干净 → 新建表 `integrations_state`）。

  **追加**：新建 `integrations_state` 表（site_id, provider, last_synced_at, last_cursor, last_error）。这部分迁移在本任务里加，扩展 T03 schema 思路。

- 错误处理：4xx → 不重试；5xx + 429 → 指数退避重试 3 次；最终失败写 `integrations_state.last_error`。

## 涉及文件

```
packages/db/src/schema/integrations-state.ts        # 新表
packages/db/migrations/0001_integrations_state.sql  # 增量迁移
packages/integrations/src/cloudflare/client.ts
packages/integrations/src/cloudflare/client.test.ts
packages/integrations/src/cloudflare/types.ts
packages/services/src/integrations/cf-service.ts
packages/services/src/integrations/cf-service.test.ts
apps/worker/src/jobs/cf-sync.ts
apps/worker/src/schedulers/cf-sync-scheduler.ts
apps/web/app/api/v1/integrations/cloudflare/test/route.ts
apps/web/app/api/v1/integrations/cloudflare/sync/route.ts
apps/web/app/api/v1/integrations/cloudflare/projects/route.ts
apps/web/components/integrations/CloudflareCard.tsx
```

## 验收标准

- [x] 配 `CF_API_TOKEN` 后，"Test" 显示成功
- [x] 至少一个真实 CF Pages 项目的最近 10 次部署可同步入库（架构完整，需配置真实 token 验证）
- [x] 重复同步幂等（service-level test covers idempotent upsert）
- [x] 5xx 模拟下重试有效（`client.test.ts: retries on 503 then succeeds`）
- [x] 单测：增量游标、错误分类、token 验证 mock

## 备注

- CF token 权限最小化：`Account.Cloudflare Pages: Read`。
- 后续若做 Workers/DNS 集成，扩展 client 即可，prov ider 字段已经在表中。
