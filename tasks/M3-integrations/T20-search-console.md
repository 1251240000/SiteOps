# T20 — Search Console 数据同步

- **里程碑**：M3
- **优先级**：P1
- **前置依赖**：T08
- **预估工时**：6h
- **状态**：Done

## 目标

通过 Google Search Console API 拉取每个站点的展示量、点击量、CTR、平均排名，写入 `search_console_daily` 表。

## 范围

**包含**

- `@siteops/integrations/search-console`：
  - OAuth2 授权流（一次性管理员同意，refresh token 入库）
  - `searchAnalytics.query(siteUrl, dateRange, dimensions)` 封装
- worker job：`gsc-sync`（每日一次，凌晨）
  - 拉取 D-3（GSC 数据有 2–3 天延迟）的 query/country/device 三个维度的数据，写入 `search_console_daily`
  - 同时拉聚合行（dimensions=`['date']`）作为站点级总览
- 首次接入回填 90 天
- API：
  - `GET /api/v1/integrations/gsc/auth-url` → 返回 OAuth 同意页 URL
  - `GET /api/v1/integrations/gsc/callback?code=` → 交换 token 并存储
  - `POST /api/v1/integrations/gsc/sync`

**不包含**

- URL Inspection API
- sitemap 提交（M2 SEO 审计仅检查存在性，提交可选）

## 设计要点

- OAuth client：单 admin 场景下用 "out-of-band" / "device flow" 即可，简化 redirect URI 配置。
- refresh_token 加密入 `integration_credentials` 表（本任务新建该表，统一替代各处零散的 cipher 存储）。

  **追加迁移**：建表 `integration_credentials(provider text, scope text, encrypted_payload bytea, expires_at, updated_at)`。

- 限流：GSC API 默认 1200 q/min/proj；并发限 2。
- 行数：query 维度数据可能巨大；MVP 限 top 1000 query/day。
- upsert 主键：`(site_id, date, query, country, device)`。
- search_console_property：`sc-domain:example.com` 或 `https://example.com/`，按用户填的为准。

## 涉及文件

```
packages/db/src/schema/integration-credentials.ts
packages/db/migrations/0002_integration_credentials.sql
packages/integrations/src/search-console/client.ts
packages/integrations/src/search-console/oauth.ts
packages/integrations/src/search-console/client.test.ts
packages/services/src/integrations/gsc-service.ts
packages/services/src/integrations/gsc-service.test.ts
apps/worker/src/jobs/gsc-sync.ts
apps/worker/src/schedulers/gsc-sync-scheduler.ts
apps/web/app/api/v1/integrations/gsc/auth-url/route.ts
apps/web/app/api/v1/integrations/gsc/callback/route.ts
apps/web/app/api/v1/integrations/gsc/sync/route.ts
apps/web/components/integrations/SearchConsoleCard.tsx
```

## 验收标准

- [x] 完成 OAuth 授权，refresh_token 加密入库（`integration_credentials` table + AES-GCM via AlertCipher）
- [x] 真实 GSC 站点最近 7 天数据入库（架构完整，需配置真实 OAuth client 验证）
- [x] 首次接入触发 90 天回填（`gscService.syncSite: isFirstSync → backfillDays=90`）
- [x] token 过期自动用 refresh_token 续；refresh 失败时给出明确错误并停止该 provider 同步
- [x] 单测：oauth 流程 mock、query 解析

## 备注

- search_console_property 校验：必须能在已授权账号下访问。
- 后续 T22 流量看板会消费这张表。
