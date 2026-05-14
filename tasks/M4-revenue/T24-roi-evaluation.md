# T24 — ROI 计算与低效站点识别

- **里程碑**：M4
- **优先级**：P2
- **前置依赖**：T22（流量看板）、T23（收入看板）
- **预估工时**：4h
- **状态**：Done

## 目标

把 T22 的流量数据 + T23 的收入数据 + 本任务录入的"成本数据"合并成单个 ROI 看板。让 admin 一眼看出：

1. **哪些站亏钱**（ROI < 0）；
2. **哪些站低效**（每千 PV 收入持续低于阈值或环比恶化）；
3. **下一步该做什么**（停掉 / 优化 / 加投入）。

## 范围

**包含**

- 新表 `site_costs`：站点月度成本录入（详见"数据模型"）
- 迁移：`packages/db/migrations/0005_site_costs.sql` + journal 更新
- Drizzle schema：`packages/db/src/schema/site-costs.ts`
- Repo：`packages/db/src/repositories/site-cost-repo.ts` — CRUD + 按 `(siteId, monthRange)` 聚合
- service：`@siteops/services/src/roi/roi-service.ts`
  - `createSiteCost / updateSiteCost / deleteSiteCost / listSiteCosts`
  - `getSiteRoi(db, siteId, { from, to })` → 单站 ROI 详情
  - `getRoiTable(db, { from, to, sortBy })` → 全站 ROI 排行（含 flag 标签）
  - `getLowEfficiencySites(db, { from, to, thresholds })` → 触发规则的站点列表
- 4 条 API：
  - `GET  /api/v1/roi/table?from&to&sortBy=roi|revenue|cost|rpm`
  - `GET  /api/v1/roi/sites/[id]?from&to`
  - `GET  /api/v1/roi/sites/[id]/costs`
  - `POST /api/v1/roi/sites/[id]/costs`（新增月度成本）
  - `PATCH/DELETE /api/v1/roi/costs/[costId]`
- UI：
  - `components/roi/RoiTable.tsx`：全站排行表（默认按 ROI 升序，负值红色高亮）
  - `components/roi/RoiKpiRow.tsx`：单站 ROI / Revenue / Cost / RPM 四卡片
  - `components/roi/RoiWaterfallChart.tsx`：单站 Revenue − Cost = Profit 瀑布图
  - `components/roi/SiteCostsTable.tsx`：成本录入表 + 行内编辑
  - `components/roi/SiteCostFormDialog.tsx`：录入 / 编辑表单
  - `components/roi/LowEfficiencyBanner.tsx`：顶部黄条提示当前命中规则的站点数
- 页面：
  - `/(dashboard)/roi/page.tsx`：全站排行
  - 复用 `/(dashboard)/sites/[id]/revenue/page.tsx`：新增 "成本" tab + ROI KPI（避免再起一个页面）

**不包含**

- 按周 / 按日成本（粒度只到月）
- 自动 ROI 预测、推荐操作生成（agent / M5）
- 多账号成本归集

## 数据模型

### `site_costs`

```sql
CREATE TABLE site_costs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  month           DATE NOT NULL,                       -- 该月第一天，e.g. 2026-03-01
  hosting_usd     NUMERIC(10, 4) NOT NULL DEFAULT 0,   -- 服务器 / Pages / CDN
  domain_usd      NUMERIC(10, 4) NOT NULL DEFAULT 0,   -- 域名摊销
  content_usd     NUMERIC(10, 4) NOT NULL DEFAULT 0,   -- 内容 / 文案外包
  ads_spend_usd   NUMERIC(10, 4) NOT NULL DEFAULT 0,   -- 站外广告投放
  other_usd       NUMERIC(10, 4) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX site_costs_site_month_uk ON site_costs(site_id, month);
CREATE INDEX site_costs_month_idx ON site_costs(month);

ALTER TABLE site_costs
  ADD CONSTRAINT site_costs_month_first_day_chk
  CHECK (EXTRACT(DAY FROM month) = 1);
ALTER TABLE site_costs
  ADD CONSTRAINT site_costs_amounts_chk
  CHECK (
    hosting_usd >= 0 AND domain_usd >= 0 AND content_usd >= 0
    AND ads_spend_usd >= 0 AND other_usd >= 0
  );
```

唯一索引 `(site_id, month)` 保证一个站每月只有一条成本记录，简化聚合。

### 计算公式

```
totalCost(site, range)        = sum(all cost columns) for months overlapping range
                              （按月与窗口的重叠天数比例摊销）
totalRevenue(site, range)     = revenueService.getSiteRevenueSummary(site, range).total
profit(site, range)           = totalRevenue − totalCost
roi(site, range)              = totalCost > 0 ? profit / totalCost : null
rpm(site, range)              = pv > 0 ? totalRevenue / pv * 1000 : null
arpu(site, range)             = uv > 0 ? totalRevenue / uv : null
```

注意：`roi` 在 `totalCost = 0` 时为 `null`（不是 +∞），UI 显示为 "N/A"。

### 低效规则（v0，可调）

UI 上把命中以下任一规则的站点放入"待处理"列表：

1. `roi < 0`（成本 > 收入）
2. `rpm < 0.5` 且 `pv > 1000`（流量够大但变现差）
3. 与前一窗口相比 `revenue` 下滑 ≥ 30% 且窗口 ≥ 14 天

规则用一个纯函数实现：

```ts
// packages/services/src/roi/rules.ts
export type LowEfficiencyFlag = 'negative_roi' | 'low_rpm' | 'declining_revenue';

export function evaluateRules(input: {
  roi: number | null;
  rpm: number | null;
  pv: number;
  revenue: number;
  revenuePrev: number;
  windowDays: number;
}): LowEfficiencyFlag[];
```

阈值参数硬编码在 service 里，加 `// TODO: make configurable` 注释；M4 不暴露给 UI 调整。

## API 响应 shape

```ts
type RoiRow = {
  siteId: string;
  slug: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  pv: number;
  uv: number;
  revenue: number;
  cost: number;
  profit: number;
  roi: number | null; // null 表示 cost=0
  rpm: number | null;
  arpu: number | null;
  flags: LowEfficiencyFlag[];
};

type SiteRoiDetail = RoiRow & {
  breakdown: {
    adRevenue: number;
    affiliateRevenue: number;
    hostingCost: number;
    domainCost: number;
    contentCost: number;
    adsSpendCost: number;
    otherCost: number;
  };
  series: Array<{ date: string; revenue: number; cost: number; profit: number }>;
  // 这里的 cost 是按天均摊的月度成本
};

type SiteCost = {
  id: string;
  siteId: string;
  month: string; // 该月第一天
  hostingUsd: number;
  domainUsd: number;
  contentUsd: number;
  adsSpendUsd: number;
  otherUsd: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
```

## 涉及文件

```
packages/db/src/schema/site-costs.ts
packages/db/migrations/0005_site_costs.sql
packages/db/migrations/meta/_journal.json                    # +0005
packages/db/src/repositories/site-cost-repo.ts
packages/db/src/repositories/index.ts                        # 导出
packages/db/src/schema/index.ts                              # 导出
packages/db/src/schema/__tests__/migrate.test.ts             # 在 expected tables 加 site_costs

packages/services/src/roi/rules.ts
packages/services/src/roi/rules.test.ts
packages/services/src/roi/roi-service.ts
packages/services/src/roi/roi-service.test.ts
packages/services/src/roi/index.ts
packages/services/src/index.ts                               # 加 roi 命名空间

apps/web/app/api/v1/roi/table/route.ts
apps/web/app/api/v1/roi/sites/[id]/route.ts
apps/web/app/api/v1/roi/sites/[id]/costs/route.ts
apps/web/app/api/v1/roi/costs/[costId]/route.ts

apps/web/components/roi/RoiTable.tsx
apps/web/components/roi/RoiKpiRow.tsx
apps/web/components/roi/RoiWaterfallChart.tsx
apps/web/components/roi/SiteCostsTable.tsx
apps/web/components/roi/SiteCostFormDialog.tsx
apps/web/components/roi/LowEfficiencyBanner.tsx
apps/web/app/(dashboard)/roi/page.tsx
apps/web/app/(dashboard)/sites/[id]/revenue/page.tsx          # 加 Cost tab + RoiKpiRow
```

## 设计要点

### 月度成本如何摊到日

- 用户录入 `(site, month=2026-03-01, hosting=30)` → service 在按天聚合时：
  - 该月共 31 天 → 每天 ≈ 0.968 美元
  - 当窗口跨月时（例如 2026-02-15 ~ 2026-03-14），每个日期点查对应月份的成本，按月内天数均摊
- 实现：`dailyCost = monthlyCost / daysInMonth(date)`
- 不缓存"已摊到日"的中间表（数据量太小，每次查询 on-the-fly 计算）

### 与 T23 的解耦

- ROI service 不直接读 `adsense_daily` / `affiliate_entries`；改调 `revenueService` 的现成方法。
- 这样未来 T23 若加新收入源（例如 Stripe），T24 自动跟上。

### 全表排序的稳定性

- API `sortBy` 仅允许枚举值：`'roi' | 'revenue' | 'cost' | 'rpm' | 'pv'`，service 用 switch 映射，避免 SQL 注入。
- 二级排序按 `slug ASC` 保证稳定（避免分页时跳动；虽然 MVP 不分页）。

### 性能

- 全表查询用 SQL 一次性 join：`sites LEFT JOIN (adsense_daily 聚合) LEFT JOIN (metrics_daily 聚合) LEFT JOIN (affiliate_entries 聚合) LEFT JOIN (site_costs 聚合)`，全部按 `site_id` 分组。
- 站数 ≤ 50 时单次查询 < 50ms。
- 不分页（MVP）；超过 50 站再考虑虚拟滚动 + 服务端分页。

### 删除策略

- 删除站点级联删除其 `site_costs` 和 `affiliate_entries`（外键已经 `ON DELETE CASCADE`）。
- 单条成本记录物理删除。

### 防呆

- 表单层禁止录入未来月份（>= 当前月可，例如 2026-03 在 2026-03 中可录入预估值；2026-04 才禁止）。
- 录入超过 \$10,000 的字段时弹一个二次确认（避免输错小数位）。

## 验收标准

- [x] 迁移 `0005_site_costs.sql` 在 fresh DB 上 apply 成功,`__tests__/migrate.test.ts` 通过
- [x] `/(dashboard)/roi` 排行表能正常显示,至少有一个站含 cost+revenue 数据,并能按各字段排序
- [x] 站点详情→"成本" Tab 下能录入 / 编辑 / 删除月度成本,单站 ROI KPI 立即刷新
- [x] 命中任一规则的站点出现在 LowEfficiencyBanner 中
- [x] 单测:`evaluateRules` 覆盖每条规则的 hit / miss + 边界(roi 恰为 0、pv 恰 = 1000 等) — 14 tests
- [x] 单测:`roiService` 覆盖 — 19 tests
  - 跨月成本均摊
  - cost = 0 时 ROI = null
  - 多个 sites 排序稳定性
- [x] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿 — 161 tests pass

## 备注

- "低效"是一个判断性概念，规则参数应可配置；M4 范围内先硬编码，给运营两周时间打数据后再调阈值（写进备忘录追到 M5 子任务）。
- ROI 表的视觉建议：负值整行淡红背景；正值且 ROI > 2 的行绿色 dot。具体 token 走 `--success` / `--destructive`。
- 后续若引入 Agent，会让它读 `/api/v1/roi/table` 并生成"本周低效站点处理建议"邮件 —— 接口预留要保持稳定。
