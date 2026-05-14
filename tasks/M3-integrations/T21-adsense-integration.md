# T21 — AdSense Management API 同步

- **里程碑**：M3
- **优先级**：P1
- **前置依赖**：T08
- **预估工时**：5h
- **状态**：Done

## 目标

通过 AdSense Management API 拉取每个站点（`adsense_publisher_id` 配置且 `adsense_status='approved'`）的每日收入、PV、impressions、clicks、RPM，写入 `adsense_daily` 表。

## 范围

**包含**

- `@siteops/integrations/adsense`：
  - OAuth2 授权流（复用 T20 的 `integration_credentials` 表机制）
  - `accounts.reports.generate(accountId, dateRange, metrics, dimensions)` 封装
- worker job：`adsense-sync`（每日一次）
  - 拉取昨日数据，按 site dimension 拆分，upsert `adsense_daily`
  - 首次接入回填 90 天
- API：
  - `GET /api/v1/integrations/adsense/auth-url`
  - `GET /api/v1/integrations/adsense/callback`
  - `POST /api/v1/integrations/adsense/sync`

**不包含**

- 广告单元 (ad units) 管理
- 自动 ads.txt 校验（M2 SEO 审计中已有）
- 多发布商账号（MVP 单 publisher）

## 设计要点

- 维度：使用 `DOMAIN_NAME` dimension 把数据拆到具体域名，再映射回 site_id（基于 `domains` 表）。
- 指标：`ESTIMATED_EARNINGS`, `PAGE_VIEWS`, `IMPRESSIONS`, `CLICKS`, `PAGE_VIEWS_RPM`, `IMPRESSIONS_CTR`。
- 货币：API 返回 publisher 账户币种，统一换算为 USD（接固定汇率表 + 注释 "MVP 简化"）。
- upsert 主键 `(site_id, date)`。
- 站点未匹配到 domain：写入 `site_id=null` 的"未归属"行（用于排查）。

## 涉及文件

```
packages/integrations/src/adsense/client.ts
packages/integrations/src/adsense/oauth.ts
packages/integrations/src/adsense/client.test.ts
packages/services/src/integrations/adsense-service.ts
packages/services/src/integrations/adsense-service.test.ts
apps/worker/src/jobs/adsense-sync.ts
apps/worker/src/schedulers/adsense-sync-scheduler.ts
apps/web/app/api/v1/integrations/adsense/auth-url/route.ts
apps/web/app/api/v1/integrations/adsense/callback/route.ts
apps/web/app/api/v1/integrations/adsense/sync/route.ts
apps/web/components/integrations/AdSenseCard.tsx
```

## 验收标准

- [x] 完成 OAuth 后 refresh_token 入库（shared `credentialsService` + AES-GCM）
- [x] 真实 publisher 数据回填 30 天（`adsenseService.backfill(deps, cfg, account, 30)`）
- [x] 域名匹配命中率（`AdSenseSyncSummary.unmatchedDomains` returned for UI; logger emits `adsense.sync` with count）
- [x] 单测：dimension 解析、域名匹配、货币换算（`parseAdSenseReport` + `toUsd` tests in `client.test.ts`）

## 备注

- AdSense 新站审核通过前 API 不返回数据；UI 在未通过状态下不应触发同步。
- 后续 T23 收入看板消费这张表。
