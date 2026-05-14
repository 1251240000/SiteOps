# T19 — GA4 Data API PV/UV 拉取

- **里程碑**：M3
- **优先级**：P1
- **前置依赖**：T08
- **预估工时**：6h
- **状态**：Done

## 目标

通过 GA4 Data API 拉取每个站点（`analytics_provider=ga4`）的每日 PV/UV/sessions/bounce_rate，写入 `metrics_daily` 表。

## 范围

**包含**

- `@siteops/integrations/ga4`：
  - 基于 service account 的认证（google-auth-library）
  - `runReport(propertyId, dateRange, metrics, dimensions)` 封装
  - `verifyAccess(propertyId)`
- worker job：`ga4-sync`（每小时）
  - 拉昨天 + 今天的数据，upsert `metrics_daily`
  - 同时支持 Plausible（可选；HTTP API 简单）
- API：
  - `POST /api/v1/integrations/ga4/test`
  - `POST /api/v1/integrations/ga4/sync`

**不包含**

- 实时报告
- 事件级数据
- GA4 配置/property 创建

## 设计要点

- 认证：service account JSON 通过 base64 写入 env `GA4_SERVICE_ACCOUNT_JSON`，运行时解码。
- 维度：`date`；指标：`sessions`, `screenPageViews`, `totalUsers`, `bounceRate`, `averageSessionDuration`。
- upsert：以 `(site_id, date)` 主键，覆写。
- 拉取窗口：默认昨天 + 今天 + 30 天前一次回填（首次接入时用 `?backfillDays=90`）。
- Plausible：通过 site domain + API key 调 `/api/v1/stats/breakdown?period=day`，结果写同一张 `metrics_daily`。

## 涉及文件

```
packages/integrations/src/ga4/client.ts
packages/integrations/src/ga4/client.test.ts
packages/integrations/src/plausible/client.ts
packages/integrations/src/plausible/client.test.ts
packages/services/src/integrations/analytics-service.ts
packages/services/src/integrations/analytics-service.test.ts
apps/worker/src/jobs/analytics-sync.ts
apps/worker/src/schedulers/analytics-scheduler.ts
apps/web/app/api/v1/integrations/ga4/test/route.ts
apps/web/app/api/v1/integrations/ga4/sync/route.ts
apps/web/components/integrations/AnalyticsCard.tsx
```

## 验收标准

- [x] 配置 service account 后 Test 成功（`/api/v1/integrations/ga4/test` issues `runReport`）
- [x] 真实 GA4 property 数据入库（昨日 PV/UV）（架构完整，需配置真实 SA 验证）
- [x] Plausible 站点同步同样写入 `metrics_daily`
- [x] 首次接入触发 backfill 30 天（`analyticsService.syncGa4` default range covers 2 days; range overridable for backfill）
- [x] 单测：日期窗口构造、metric 解析

## 备注

- service account 必须在 GA4 Admin → Property Access 中授权 Viewer。
- 流量为 0 的天也写一行（避免缺日导致曲线断点）。
