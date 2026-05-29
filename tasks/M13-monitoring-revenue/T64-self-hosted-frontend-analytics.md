# T64 — 自研前端埋点 SDK + RUM 采集

- **里程碑**：M13
- **优先级**：P2
- **前置依赖**：T08, T22
- **预估工时**：6 h
- **状态**：Done

## 目标

提供一套可嵌入各站点的自研前端埋点 SDK，采集 pageview、visitor/session、基础事件与 Web Vitals，写入 SiteOps 后用于补齐 GA4 不可用或数据延迟时的站点运营分析。

## 范围

**包含**

- 新增轻量浏览器 SDK：`@siteops/tracker`，支持 CDN script 与 npm import 两种接入方式
- 自动采集 pageview、referrer、utm、device、locale、screen、path、title、匿名 visitor/session id
- 手动事件 API：`track(eventName, properties)` 与 `identify(userId, traits?)`
- Web Vitals / RUM 指标采集：LCP、CLS、INP、FCP、TTFB（可复用 `web-vitals`）
- 接收端 API：`POST /api/v1/collect`，按 site public key 鉴权，支持 `navigator.sendBeacon` 与 JSON fetch
- 数据表：`analytics_events` / `analytics_sessions`，按 site + time 建索引，保留原始 payload 的 JSONB 扩展字段
- 基础聚合：站点维度 PV、UV、session、top pages、top referrers、utm source、Web Vitals p75
- UI：流量看板优先使用自研埋点数据；GA4 数据保留为外部来源对照

**不包含**

- 完整替代 GA4 的复杂归因、多渠道漏斗与广告平台归因
- 跨站用户打通或第三方 cookie 方案
- 热力图、录屏、DOM 点击自动采集（隐私与体积风险较高，v2 再评估）
- 服务端埋点 SDK（先只做 browser SDK）

## 设计要点

### SDK 初始化

```ts
import { createTracker } from '@siteops/tracker';

const tracker = createTracker({
  siteKey: 'site_pk_xxx',
  endpoint: 'https://ops.example.com/api/v1/collect',
  autoPageview: true,
  sampleRate: 1,
});

tracker.track('signup_click', { plan: 'pro' });
tracker.identify('user_123', { emailHash: 'sha256:...' });
```

- SDK 默认不采集 PII；`identify` 只允许业务方传入已脱敏标识；服务端会拒绝明显敏感字段（如 `email`、`phone`、`password`、`token`）
- SDK payload 体积上限：单事件 properties 序列化后不超过 8 KiB，单批最多 50 条事件，超限事件丢弃并在 debug 模式告警
- visitor id 存 `localStorage`，session id 存 `sessionStorage`，不可用时降级内存态；session 默认 30 分钟滚动过期
- pageview 在 SPA 路由变化时可由宿主手动调用 `tracker.pageview(path)`，v1 不强依赖具体框架
- 批量发送：事件进入内存 queue，满足 `batchSize` 或 `flushInterval` 后发送；页面隐藏时优先 `sendBeacon`，失败再降级 JSON fetch

### Collect API payload

```ts
type CollectPayload = {
  siteKey: string;
  sentAt: string;
  visitorId: string;
  sessionId: string;
  events: Array<{
    type: 'pageview' | 'event' | 'web_vital' | 'identify';
    name: string;
    ts: string;
    path?: string;
    url?: string;
    referrer?: string;
    properties?: Record<string, unknown>;
  }>;
};
```

- `siteKey` 映射到 `sites.public_analytics_key`，不是管理 API key
- 服务端按 `siteId + visitorId + sessionId + event hash` 做短窗口去重，避免 beacon/fetch 双发
- API 返回 `202 Accepted`；入库失败只记录错误日志，不阻塞站点页面
- CORS 只允许站点注册域名及其子域，避免被任意站点滥用

### 数据模型草案

```sql
CREATE TABLE analytics_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  visitor_id  TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  referrer    TEXT,
  utm         JSONB,
  device      JSONB,
  UNIQUE (site_id, session_id)
);

CREATE TABLE analytics_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id  TEXT NOT NULL,
  visitor_id  TEXT NOT NULL,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  path        TEXT,
  properties  JSONB,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_site_time_idx ON analytics_events (site_id, occurred_at DESC);
CREATE INDEX analytics_events_site_type_name_idx ON analytics_events (site_id, type, name, occurred_at DESC);
```

## 涉及文件

```
packages/tracker/package.json                         # 新包 @siteops/tracker
packages/tracker/src/index.ts                         # createTracker / track / identify / pageview
packages/tracker/src/queue.ts                         # batch + sendBeacon/fetch flush
packages/tracker/src/web-vitals.ts                    # RUM 指标采集
packages/shared/src/schemas/analytics.ts              # collect schema / query schema
packages/db/migrations/00XX_analytics_events.sql      # analytics_sessions/events
packages/db/src/schema/analytics.ts
packages/db/src/repositories/analytics-repo.ts
packages/services/src/analytics/collect-service.ts
packages/services/src/analytics/aggregate-service.ts
apps/web/app/api/v1/collect/route.ts
apps/web/app/api/v1/sites/[id]/analytics/route.ts
apps/web/app/(dashboard)/sites/[id]/analytics/page.tsx
apps/web/app/(dashboard)/sites/[id]/_components/analytics-summary.tsx
apps/web/lib/queries/analytics.ts
```

## 验收标准

- [ ] 测试站点嵌入 CDN script 后，首次访问自动写入 1 条 pageview 与 1 个 session
- [ ] `tracker.track('cta_click')` 能写入 analytics_events，properties JSON 保留
- [ ] 页面 `visibilitychange` 时使用 `sendBeacon` flush，刷新/关闭页面不明显丢事件
- [ ] CORS 仅允许站点注册域名；错误 siteKey 返回 401/403 且不入库
- [ ] 站点 analytics 页展示 7d PV/UV/session、top pages、top referrers 与 Web Vitals p75
- [ ] 与 T22 流量看板的数据来源标识清晰：Self-hosted / GA4 / Search Console
- [ ] 单测覆盖 SDK queue、collect schema、去重逻辑与聚合 SQL
- [ ] `pnpm -r typecheck && lint && test` 全绿
