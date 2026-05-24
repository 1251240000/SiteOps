# T57 — Core Web Vitals 趋势图

- **里程碑**：M13
- **优先级**：P2
- **前置依赖**：T14
- **预估工时**：4 h
- **状态**：Todo

## 目标

把 Lighthouse 历史数据（已经在 `lighthouse_runs` / `audits`）出一个站点维度的 CWV 时序图：LCP / CLS / INP / TBT 折线 + 标注重大事件（deployment / SSL renewal），让 admin 一眼看出"哪天回归了"。

## 范围

**包含**

- repo 加 `metricsRepo.cwvSeries(siteId, from, to, granularity)`，返回按日聚合的 LCP/CLS/INP/TBT 均值与 p90
- 路由 `GET /api/v1/sites/{id}/cwv-series?days=30&granularity=day`
- UI：`/(dashboard)/sites/[id]/page.tsx` 加 CWV trend tab
- 用 `recharts`（已依赖）绘制 4 个指标的 dual-y-axis 折线图
- 事件标注：deployment、ssl renewal 时间点在 x 轴上标 marker

**不包含**

- 真实用户监控（RUM）—— Lighthouse 是 synthetic baseline，足够 v1
- 自动告警 CWV 回归（用现有 alert rule 规则可覆盖）

## 设计要点

### Repo

```ts
// metrics-repo.ts
async function cwvSeries(db, siteId, from, to, granularity: 'day' | 'week') {
  return db.execute<{
    bucket: Date;
    lcp_avg: number;
    cls_avg: number;
    inp_avg: number;
    tbt_avg: number;
    n: number;
  }>(sql`
    SELECT
      date_trunc(${granularity}, started_at) AS bucket,
      avg((lighthouse_json->'audits'->'largest-contentful-paint'->>'numericValue')::float) AS lcp_avg,
      avg((lighthouse_json->'audits'->'cumulative-layout-shift'->>'numericValue')::float) AS cls_avg,
      avg((lighthouse_json->'audits'->'interaction-to-next-paint'->>'numericValue')::float) AS inp_avg,
      avg((lighthouse_json->'audits'->'total-blocking-time'->>'numericValue')::float) AS tbt_avg,
      count(*) AS n
    FROM lighthouse_runs
    WHERE site_id = ${siteId}
      AND started_at >= ${from} AND started_at < ${to}
      AND status = 'success'
    GROUP BY bucket
    ORDER BY bucket;
  `);
}
```

### 事件标注

deployment / SSL renewal 时间点作为 reference line：

```tsx
<LineChart data={series}>
  <Line dataKey="lcp_avg" yAxisId="ms" stroke="#3b82f6" name="LCP" />
  <Line dataKey="inp_avg" yAxisId="ms" stroke="#22c55e" name="INP" />
  <Line dataKey="tbt_avg" yAxisId="ms" stroke="#a855f7" name="TBT" />
  <Line dataKey="cls_avg" yAxisId="ratio" stroke="#ef4444" name="CLS" />
  {deployments.map((d) => (
    <ReferenceLine
      key={d.id}
      x={d.deployedAt}
      yAxisId="ms"
      stroke="#9ca3af"
      strokeDasharray="4 4"
      label="deploy"
    />
  ))}
</LineChart>
```

- LCP / INP / TBT 共用 ms 轴；CLS 用独立比例轴
- 用 `Brush` 让用户拖拽时间窗

## 涉及文件

```
packages/db/src/repositories/metrics-repo.ts                  # cwvSeries
apps/web/app/api/v1/sites/[id]/cwv-series/route.ts            # 新
apps/web/app/(dashboard)/sites/[id]/page.tsx                  # 加 tab
apps/web/app/(dashboard)/sites/[id]/_components/cwv-chart.tsx # 新
apps/web/lib/queries/sites.ts                                  # 加 hook
packages/shared/src/schemas/metrics.ts                        # cwvSeriesQuerySchema
```

## 验收标准

- [ ] 30 天数据下能看到 30 个日聚合点
- [ ] granularity=week 时返回周聚合
- [ ] 部署 marker 显示正确日期
- [ ] hover 显示 tooltip 含均值与样本数
- [ ] 无数据时空状态友好（"该时间窗无 Lighthouse 数据"）
- [ ] `pnpm -r typecheck && lint && test` 全绿
