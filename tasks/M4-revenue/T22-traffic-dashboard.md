# T22 — 流量看板（单站 + 全局）

- **里程碑**：M4
- **优先级**：P2
- **前置依赖**：T19（GA4/Plausible 入库）、T20（GSC 入库）
- **预估工时**：8h
- **状态**：Done

## 目标

把 `metrics_daily`（GA4 / Plausible）和 `search_console_daily`（GSC）变成可视化的流量看板。提供两种视角：

1. **全局**：`/(dashboard)/traffic` — 所有站点的累计 PV / UV / Sessions / Bounce + Top-N 站点排行。
2. **单站**：`/(dashboard)/sites/[id]/traffic` — 单站时间序列 + GSC 关键词表。

## 范围

**包含**

- 新 service：`@siteops/services/src/metrics/traffic-service.ts`
  - `getGlobalSummary(db, { from, to })` → 全站累计指标 + 同比环比
  - `getGlobalSeries(db, { from, to, granularity })` → 全站日/周聚合序列
  - `getTopSites(db, { from, to, metric, limit })` → 按指标排序的 Top-N 站
  - `getSiteSummary(db, siteId, { from, to })` → 单站累计指标
  - `getSiteSeries(db, siteId, { from, to, granularity })` → 单站日序列
  - `getSiteSearchSummary(db, siteId, { from, to })` → GSC 累计 impressions / clicks / 平均 CTR / 平均 position
  - `getSiteTopQueries(db, siteId, { from, to, limit })` → 单站 Top-N 搜索词
- 5 条 API 路由：
  - `GET /api/v1/metrics/global/summary?from&to`
  - `GET /api/v1/metrics/global/series?from&to&granularity=day|week`
  - `GET /api/v1/metrics/global/top-sites?from&to&metric=pv|uv|sessions&limit=10`
  - `GET /api/v1/metrics/sites/[id]/series?from&to&granularity=day`
  - `GET /api/v1/metrics/sites/[id]/search?from&to[&topQueries]`
- 新增依赖：`recharts@^2.13` （图表库；shadcn 生态默认推荐）
- UI 组件：
  - `components/traffic/TrafficKpiRow.tsx`：4 个 KPI 卡片（PV、UV、Sessions、平均会话时长），含同比箭头
  - `components/traffic/TrafficLineChart.tsx`：基于 Recharts 的折线图，多指标可切换
  - `components/traffic/TopSitesTable.tsx`：全局 Top-N 站表（用 `@tanstack/react-table`，复用已有 patterns）
  - `components/traffic/SearchConsolePanel.tsx`：GSC KPI + Top queries
- 页面：
  - `/(dashboard)/traffic/page.tsx`：全局看板，含日期选择器（默认 30 天）
  - `/(dashboard)/sites/[id]/traffic/page.tsx`：单站看板
  - 在站点详情侧栏 / Tabs 加一个"流量"链接

**不包含**

- GA4/Plausible/GSC 反向写入（只读）
- 实时（live）数据流
- 数据导出（CSV / PDF）
- 多账号 / 多 GA4 property 维度（一个站 = 一个 property）

## 设计要点

### 日期窗口

- 全部 query 参数走 ISO date（`YYYY-MM-DD`），UTC，inclusive `[from, to]`。
- 默认窗口：last 30 days（含今日）。
- 同比窗口：自动用 `from − (to − from + 1)` 推前一个等长窗口，仅在 `summary` 接口返回。

### 聚合粒度

- `granularity=day`：直接 group by `date`。
- `granularity=week`：`date_trunc('week', date)` (Postgres 默认周一开始)；service 里加一个 `// note: ISO week 1=Monday` 注释。
- 月级别在 M4 范围外。

### service 实现建议

```ts
// packages/services/src/metrics/traffic-service.ts
export const trafficService = {
  async getGlobalSummary(db: Db, range: DateRange): Promise<GlobalSummary> {
    // sum() over metrics_daily WHERE date BETWEEN from AND to
    // 同期对比：再跑一次前一个窗口
  },

  async getGlobalSeries(db: Db, range: DateRange, granularity: 'day' | 'week') {
    // group by date_trunc(...)
  },

  async getTopSites(db: Db, range: DateRange, metric: 'pv' | 'uv' | 'sessions', limit = 10) {
    // join sites for slug/name; ORDER BY sum(metric) DESC LIMIT
  },

  // ... 单站方法对称实现
};
```

### 缺日填充

- 折线图不允许出现"断点"。service 返回前用 `fillDateRange(rows, from, to)` 把缺的日期补 0。共享工具放 `packages/shared/src/date/fill-range.ts`。

### 图表库选型

- 选 **Recharts**：纯 React、SVG 渲染、支持 dark mode（用 currentColor）、bundle 体积可接受（~80kb gz）。
- 不选 Chart.js / ECharts：Chart.js 在 SSR 下需要 dynamic import；ECharts 体积过大。
- 不选 Tremor：依赖锁定太重；几个图就够，没必要引整套组件库。

### 数据访问

- 所有 service 方法接收 `Db`（drizzle handle）+ 显式参数，不读 `getDb()`。route handler 负责注入 `getDb()`。
- service 测试用 `createTestDb()` + 直接 `insert` seed data。

### 性能

- 数据量级：10 站 × 365 天 = 3650 行，毫秒级。索引已经在 M0/M3 加好（`metrics_daily_site_date_uk` + `metrics_daily_date_idx`）。
- 不做 Redis 缓存（数据每小时才更新一次，DB 查询足够快）。

## 涉及文件

```
packages/shared/src/date/fill-range.ts                          # 缺日填充工具
packages/shared/src/date/fill-range.test.ts
packages/services/src/metrics/traffic-service.ts
packages/services/src/metrics/traffic-service.test.ts
packages/services/src/metrics/index.ts                          # 命名空间导出
packages/services/src/index.ts                                  # 加 metrics 命名空间

apps/web/app/api/v1/metrics/global/summary/route.ts
apps/web/app/api/v1/metrics/global/series/route.ts
apps/web/app/api/v1/metrics/global/top-sites/route.ts
apps/web/app/api/v1/metrics/sites/[id]/series/route.ts
apps/web/app/api/v1/metrics/sites/[id]/search/route.ts

apps/web/components/traffic/TrafficKpiRow.tsx
apps/web/components/traffic/TrafficLineChart.tsx
apps/web/components/traffic/TopSitesTable.tsx
apps/web/components/traffic/SearchConsolePanel.tsx
apps/web/components/traffic/DateRangePicker.tsx                 # 复用到 T23/T24
apps/web/app/(dashboard)/traffic/page.tsx
apps/web/app/(dashboard)/sites/[id]/traffic/page.tsx

apps/web/package.json                                           # +recharts
```

## API 响应 shape（约定）

```ts
type GlobalSummary = {
  pv: number;
  uv: number;
  sessions: number;
  avgSessionSec: number | null;
  bounceRate: number | null; // 0..1
  pvPrev: number; // 上一个等长窗口
  uvPrev: number;
  sessionsPrev: number;
  delta: { pv: number; uv: number; sessions: number }; // 0..1，百分比
};

type SeriesPoint = { date: string; pv: number; uv: number; sessions: number };
type SeriesResponse = { points: SeriesPoint[]; granularity: 'day' | 'week' };

type TopSiteRow = {
  siteId: string;
  slug: string;
  name: string;
  pv: number;
  uv: number;
  sessions: number;
};

type SearchSummary = {
  impressions: number;
  clicks: number;
  ctr: number; // 0..1
  avgPosition: number; // 1..N
};

type TopQueryRow = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
```

所有响应统一走 `lib/with-api.ts:ok()` 信封：`{ data: ..., error: null }`。

## 验收标准

- [ ] `pnpm dev`下打开 `/traffic` 能看到 KPI 行 + 折线 + Top-N 表，全部为真实数据（前提：至少有一个站完成 GA4 同步）
- [ ] 站点详情下"流量"Tab 能正常切换日期范围，曲线无断点
- [ ] `GET /api/v1/metrics/global/series?granularity=week` 返回的点数 = `ceil((to−from+1)/7)`
- [ ] 单测：`fillDateRange` 覆盖 0/1/N 行的所有边界情况
- [ ] 单测：`trafficService` 4 个核心方法（`getGlobalSummary`、`getGlobalSeries`、`getTopSites`、`getSiteSearchSummary`）至少 8 个 case
- [ ] 全 monorepo `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿
- [ ] 新页面在浅 / 深主题下均无色差或对比度问题

## 备注

- 图表组件第一次接入 Recharts，需要在 `next.config.js` 里检查是否需要 `transpilePackages: ['recharts']`（Next 15 多数情况下不需要）。
- `DateRangePicker` 实现得通用一点（受 `nuqs` 控制的 URL query params），T23 / T24 直接复用。
- 后续 M5 / agent 集成时，这些 API 会成为只读"运营数据"接入点，注意保持响应稳定。
