# T59 — 预算告警 + A/B 实验跟踪

- **里程碑**：M13
- **优先级**：P2
- **前置依赖**：T23, T16
- **预估工时**：3 h
- **状态**:Todo

## 目标

两个低耦合小功能合并实现：

1. **预算告警**：站点月度 site_costs 超阈值时触发 alert，避免哑巴亏；
2. **A/B 实验跟踪**：站点端 SDK `POST /track` 上报实验事件，平台聚合写入 `experiment_events` 表。

## 范围

**包含**

### 预算告警

- 在 `sites` 表加 `monthly_budget_cents INT` 列（NULL 表示不监控）
- 新 alert rule kind：`site.budget_exceeded`，scheduler 每 6 小时检查
- 当 sum(site_costs.month_to_date) > monthly_budget → 触发 alert
- UI：site settings 加 budget 输入框

### A/B 实验跟踪

- 新表 `experiment_events`：
  ```sql
  CREATE TABLE experiment_events (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id        UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    experiment_id  TEXT NOT NULL,
    variant        TEXT NOT NULL,
    event_type     TEXT NOT NULL,            -- 'exposure' | 'conversion'
    user_id        TEXT,                     -- 站点匿名 ID
    metadata       JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX experiment_events_site_exp_idx ON experiment_events (site_id, experiment_id, created_at);
  ```
- 路由 `POST /api/v1/sites/{siteId}/track`（站点端 SDK 用，认证可选 API key）
- 简单聚合 view：`/sites/[id]/experiments` 展示 each experiment_id 的 exposure / conversion / rate
- 不做显著性分析

**不包含**

- 自动 promotion / variant 分配（站点端自己分流）
- 与 revenue 自动 join 算 lift（v2）

## 设计要点

### Budget 检查 job

```ts
// apps/worker/src/jobs/budget-check.ts
async function processBudgetCheck() {
  const sites = await siteRepo.listWithBudget(db); // monthly_budget_cents IS NOT NULL
  for (const site of sites) {
    const mtd = await siteCostsRepo.sumMonthToDate(db, site.id);
    if (mtd > site.monthlyBudgetCents) {
      await alertService.fire({
        ruleId: BUDGET_EXCEEDED_RULE_ID, // 预置 builtin rule
        siteId: site.id,
        message: `Budget exceeded: $${(mtd / 100).toFixed(2)} / $${(site.monthlyBudgetCents / 100).toFixed(2)}`,
      });
    }
  }
}
```

### Track API

```ts
// route.ts POST /sites/{siteId}/track
const body = trackSchema.parse(await req.json());
await experimentEventRepo.insert(db, {
  siteId,
  experimentId: body.experimentId,
  variant: body.variant,
  eventType: body.eventType,
  userId: body.userId,
  metadata: body.metadata,
});
return ok({ accepted: true }, { status: 202 });
```

- 入库异步化（fire-and-forget），失败仅 log
- 限流：复用 API key rate-limit；无 API key 时也允许（site_id 已经在 URL），但加 IP rate-limit

### 实验聚合

```sql
SELECT variant,
       count(*) FILTER (WHERE event_type='exposure') AS exposures,
       count(*) FILTER (WHERE event_type='conversion') AS conversions
FROM experiment_events
WHERE site_id = $1 AND experiment_id = $2
GROUP BY variant;
```

## 涉及文件

```
packages/db/migrations/00XX_sites_budget.sql              # ADD COLUMN
packages/db/migrations/00XX+1_experiment_events.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/sites.ts
packages/db/src/schema/experiment-events.ts
packages/db/src/repositories/experiment-event-repo.ts
packages/services/src/revenue/budget-service.ts
packages/services/src/revenue/experiments-service.ts
packages/shared/src/schemas/track.ts
apps/worker/src/jobs/budget-check.ts
apps/worker/src/schedulers/budget-check-scheduler.ts
apps/worker/src/queues.ts                                  # +budget-check
apps/worker/src/index.ts
apps/web/app/api/v1/sites/[id]/track/route.ts
apps/web/app/api/v1/sites/[id]/experiments/route.ts
apps/web/app/(dashboard)/sites/[id]/experiments/page.tsx
apps/web/app/(dashboard)/sites/[id]/settings/_components/budget-card.tsx
```

## 验收标准

- [ ] site 配置 budget=$100，site_costs 月内累计达 $101 → 6 小时内触发 alert
- [ ] `POST /sites/{id}/track` 写入 experiment_events
- [ ] `/sites/[id]/experiments` 显示按 variant 的 exposure/conversion 表
- [ ] viewer 仅 read，operator+admin 可改 budget
- [ ] `pnpm -r typecheck && lint && test` 全绿
