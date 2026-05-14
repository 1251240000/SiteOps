# T23 — 收入看板（Ads + Affiliate 手动）

- **里程碑**：M4
- **优先级**：P2
- **前置依赖**：T21（AdSense 入库）
- **预估工时**：6h
- **状态**：Done

## 目标

把 AdSense 自动同步的数据（`adsense_daily`）与人工录入的联盟 / 一次性收入合并到一张"收入"视图。提供两种视角：

1. **全局**：`/(dashboard)/revenue` — 全站累计收入、按来源拆分（Ads vs Affiliate）、按站排名。
2. **单站**：`/(dashboard)/sites/[id]/revenue` — 单站时间序列 + 手动录入面板。

## 范围

**包含**

- 新表 `affiliate_entries`：联盟 / 其他人工收入按周期录入（详见"数据模型"段）
- 迁移：`packages/db/migrations/0004_affiliate_entries.sql` + journal 更新
- Drizzle schema：`packages/db/src/schema/affiliate-entries.ts` + 注册到 `schema/index.ts`
- Repo：`packages/db/src/repositories/affiliate-entry-repo.ts` — CRUD + 按 `(siteId, dateRange)` 聚合
- service：`@siteops/services/src/revenue/revenue-service.ts`
  - `createAffiliateEntry(db, input)` / `updateAffiliateEntry` / `deleteAffiliateEntry` / `listAffiliateEntries(db, siteId, range)`
  - `getGlobalRevenueSummary(db, range)` → `{ adRevenue, affiliateRevenue, total, prevTotal, delta }`
  - `getGlobalRevenueSeries(db, range, granularity)` → 按日 / 周分组的 ad + affiliate 数列
  - `getSiteRevenueSummary(db, siteId, range)` → 单站累计
  - `getSiteRevenueSeries(db, siteId, range, granularity)` → 单站时间序列
  - `getTopRevenueSites(db, range, limit)` → 按 total revenue 排序
- 7 条 API：
  - `GET  /api/v1/revenue/global/summary?from&to`
  - `GET  /api/v1/revenue/global/series?from&to&granularity=day|week`
  - `GET  /api/v1/revenue/global/top-sites?from&to&limit`
  - `GET  /api/v1/revenue/sites/[id]/series?from&to&granularity=day`
  - `GET  /api/v1/revenue/sites/[id]/affiliate-entries`（列表）
  - `POST /api/v1/revenue/sites/[id]/affiliate-entries`（新增）
  - `PATCH/DELETE /api/v1/revenue/affiliate-entries/[entryId]`（编辑 / 删除）
- UI：
  - `components/revenue/RevenueKpiRow.tsx`：Total / Ads / Affiliate / ARPV (每 PV 收入) 四个 KPI
  - `components/revenue/RevenueStackedBarChart.tsx`：按来源堆叠柱状图（复用 T22 的 Recharts）
  - `components/revenue/RevenueLineChart.tsx`：曲线版（与堆叠图切换）
  - `components/revenue/TopRevenueSitesTable.tsx`：全局排行表
  - `components/revenue/AffiliateEntriesTable.tsx`：单站联盟录入表 + 行内编辑
  - `components/revenue/AffiliateEntryFormDialog.tsx`：录入 / 编辑表单（react-hook-form + zod）
- 页面：
  - `/(dashboard)/revenue/page.tsx`
  - `/(dashboard)/sites/[id]/revenue/page.tsx`

**不包含**

- 多币种实时汇率（沿用 T21 固定汇率表）
- 自动从外部联盟 API（Amazon Associates / Impact / Awin 等）拉数据 → 放 M5+
- 税务计算 / 发票
- 收入预测 / 趋势 AI 解读

## 数据模型

### `affiliate_entries`

```sql
CREATE TABLE affiliate_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,                       -- 收入归属期开始（含）
  period_end   DATE NOT NULL,                       -- 收入归属期结束（含）
  program      TEXT NOT NULL,                       -- 联盟名（Amazon / Impact / 自由文本）
  amount_usd   NUMERIC(10, 4) NOT NULL,             -- 折算后的 USD 金额
  amount_raw   NUMERIC(10, 4),                      -- 原币金额（可选）
  currency     TEXT,                                -- 原币种 ISO-4217（可选）
  payout_date  DATE,                                -- 实际到账日（可选）
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX affiliate_entries_site_period_idx
  ON affiliate_entries(site_id, period_start, period_end);
CREATE INDEX affiliate_entries_period_idx
  ON affiliate_entries(period_start, period_end);

ALTER TABLE affiliate_entries
  ADD CONSTRAINT affiliate_entries_period_chk
  CHECK (period_end >= period_start);
ALTER TABLE affiliate_entries
  ADD CONSTRAINT affiliate_entries_amount_chk
  CHECK (amount_usd >= 0);
```

### 聚合到时间序列时的拆分约定

- 用户录入的是一段区间（例如"3月联盟收入 \$123"），聚合到日序列时按 **均摊** 处理：`daily_amount = amount_usd / (period_end − period_start + 1)`。
- service 输出时附 `attribution: 'spread'` 字段以便 UI 标注（区别于按日精确的 AdSense）。

### Ad 收入

- 直接从 `adsense_daily.earnings_usd` 取，无需镜像写入 `metrics_daily`。
- `metrics_daily.ad_revenue_usd` / `affiliate_revenue_usd` 这两列在 M4 范围里**不维护**（保留给未来 ETL roll-up；当前 service 直接 join 原始表）。

## API 响应 shape

```ts
type RevenueSummary = {
  adRevenue: number;
  affiliateRevenue: number;
  total: number;
  totalPrev: number;
  delta: number; // 0..1 (相对上一窗口)
  topProgram: string | null; // 当期占比最高的 affiliate program
};

type RevenuePoint = {
  date: string;
  adRevenue: number;
  affiliateRevenue: number;
};

type AffiliateEntry = {
  id: string;
  siteId: string;
  periodStart: string;
  periodEnd: string;
  program: string;
  amountUsd: number;
  amountRaw: number | null;
  currency: string | null;
  payoutDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
```

## 涉及文件

```
packages/db/src/schema/affiliate-entries.ts
packages/db/migrations/0004_affiliate_entries.sql
packages/db/migrations/meta/_journal.json                    # +0004
packages/db/src/repositories/affiliate-entry-repo.ts
packages/db/src/repositories/index.ts                        # 导出
packages/db/src/schema/index.ts                              # 导出
packages/db/src/schema/__tests__/migrate.test.ts             # 在 expected tables 加入

packages/services/src/revenue/revenue-service.ts
packages/services/src/revenue/revenue-service.test.ts
packages/services/src/revenue/index.ts
packages/services/src/index.ts                               # 加 revenue 命名空间

apps/web/app/api/v1/revenue/global/summary/route.ts
apps/web/app/api/v1/revenue/global/series/route.ts
apps/web/app/api/v1/revenue/global/top-sites/route.ts
apps/web/app/api/v1/revenue/sites/[id]/series/route.ts
apps/web/app/api/v1/revenue/sites/[id]/affiliate-entries/route.ts
apps/web/app/api/v1/revenue/affiliate-entries/[entryId]/route.ts

apps/web/components/revenue/RevenueKpiRow.tsx
apps/web/components/revenue/RevenueStackedBarChart.tsx
apps/web/components/revenue/RevenueLineChart.tsx
apps/web/components/revenue/TopRevenueSitesTable.tsx
apps/web/components/revenue/AffiliateEntriesTable.tsx
apps/web/components/revenue/AffiliateEntryFormDialog.tsx
apps/web/app/(dashboard)/revenue/page.tsx
apps/web/app/(dashboard)/sites/[id]/revenue/page.tsx
```

## 设计要点

### 写入校验

- 表单层用 zod schema（共享给 service 校验，避免重复）：
  - `periodEnd >= periodStart`
  - `amountUsd >= 0`
  - `program` 非空 ≤ 64 字符
  - `currency` 若提供必须是 ISO-4217 3 字母大写
- service 层再做一次：route handler 拿到 `AppError(code='validation_failed')` 即可。

### 同站 / 同期重复录入

- 不强制唯一（一段时间内可能有多条不同联盟项目的收入）；UI 在表单上提示"建议每个 program/period 仅录入一次"。
- 后续若要去重，加 `UNIQUE (site_id, program, period_start, period_end)` 索引，但 MVP 不加。

### 货币换算

- `amount_raw` + `currency` 为可选透明字段，**真正使用的是 `amount_usd`**。
- service 不替用户做汇率换算（避免错算）；UI 在表单旁挂一个"换算助手"按钮链到外部计算器（或纯文字说明）。

### 删除策略

- `DELETE /affiliate-entries/[entryId]` 物理删除；M4 不引入软删 / 审计日志（量小，admin 单人）。

### 与 T24 的接口

- T24 的 ROI service 直接调本任务的 `revenueService.getSiteRevenueSummary(...)`，不另写聚合 SQL。

## 验收标准

- [ ] 迁移 `0004_affiliate_entries.sql` 在 fresh DB 上 apply 成功，`__tests__/migrate.test.ts` 通过
- [ ] `/(dashboard)/revenue` 全局看板正常显示真实 AdSense 数据
- [ ] 在站点详情→"收入" Tab 下，能录入一条联盟收入并立刻反映在曲线和 KPI
- [ ] 编辑 / 删除联盟收入工作正常，乐观更新 + 失败回滚 toast
- [ ] 单测：`revenueService` 覆盖
  - 累计求和（AdSense + Affiliate 区间均摊）
  - 同比窗口
  - 单站 vs 全局对称
- [ ] Repo 单测：CRUD + 区间查询正确
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿

## 备注

- "区间均摊"是一个产品取舍：另一个选项是把联盟收入完整记到 `period_end` 那一天。均摊更适合趋势图但和现金流时间错位；MVP 先选均摊，后续可加用户偏好。
- 联盟项目下拉建议：service 内置一个 `getKnownPrograms()` 返回过去 90 天出现过的 program 字符串，UI 用作 autocomplete suggestions。
