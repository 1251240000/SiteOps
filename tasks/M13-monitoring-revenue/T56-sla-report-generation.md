# T56 — SLA / Uptime 报告生成

- **里程碑**：M13
- **优先级**：P2
- **前置依赖**：T11, T22
- **预估工时**：6 h
- **状态**：Todo

## 目标

按月（或自定义时间窗）自动汇总站点的 uptime 百分比、平均响应、关键 alert 总数、性能 KPI，生成 Markdown + PDF 报告，dashboard 内可下载。

## 范围

**包含**

- 报告生成 service：`packages/services/src/reports/sla-report-service.ts.generate(siteId, from, to)`
- Markdown 模板：包含 uptime%、p50/p95 响应、alert 摘要表、CWV 月度均值、ROI 总览
- PDF 渲染：用 `puppeteer-core`（worker 镜像内已有 chromium）+ md-to-html
- 路由 `GET /api/v1/sites/{id}/reports/sla?from=...&to=...&format=md|pdf`
- 缓存：相同 (siteId, from, to) 24h 内复用，避免重复生成
- UI：`/(dashboard)/sites/[id]/reports` 时间选择 + 下载按钮

**不包含**

- 邮件自动推送（admin 手动下载即可）
- 多语言报告（仅中文 + 英文）
- 模板可视化定制

## 设计要点

### 数据收集

```ts
// services/src/reports/sla-report-service.ts
type SlaReportData = {
  site: Site;
  from: Date;
  to: Date;
  uptime: { percentage: number; totalChecks: number; failed: number; downtime: number /* min */ };
  responseTime: { p50: number; p95: number; p99: number };
  alerts: { total: number; bySeverity: Record<string, number>; recentList: Alert[] };
  cwv: { lcp: { avg: number; trend: 'up' | 'down' | 'flat' }; cls: ...; inp: ... };
  roi: { revenue: number; cost: number; net: number; rpm: number };
};

async function generate(deps, siteId, from, to): Promise<SlaReportData> {
  // 并发调多个 repository 查询
  const [site, uptime, responseTime, alerts, cwv, roi] = await Promise.all([
    siteRepo.getById(deps.db, siteId),
    uptimeRepo.aggregateForRange(deps.db, siteId, from, to),
    uptimeRepo.responsePercentiles(deps.db, siteId, from, to),
    alertRepo.summarize(deps.db, siteId, from, to),
    metricsRepo.cwvTrend(deps.db, siteId, from, to),
    roiRepo.summarize(deps.db, siteId, from, to),
  ]);
  return { site, from, to, uptime, responseTime, alerts, cwv, roi };
}
```

### Markdown 模板

```md
# SLA Report — {site.name}

**Period**: {from} → {to}

## Uptime

- Availability: **{uptime.percentage}%**
- Total checks: {uptime.totalChecks}
- Failed: {uptime.failed}
- Estimated downtime: {uptime.downtime} min

## Response Time

| p50     | p95     | p99     |
| ------- | ------- | ------- |
| {p50}ms | {p95}ms | {p99}ms |

## Alerts

- Total: {alerts.total}
- Critical: {alerts.bySeverity.critical}
- Warning: {alerts.bySeverity.warning}

| Triggered At | Rule | Status |
| ... |

## Core Web Vitals

- LCP avg: {lcp.avg}ms ({lcp.trend})
- CLS avg: {cls.avg} ({cls.trend})
- INP avg: {inp.avg}ms ({inp.trend})

## Revenue & Cost

- Revenue: ${roi.revenue}
- Cost: ${roi.cost}
- Net: ${roi.net}
- RPM: ${roi.rpm}
```

### PDF 渲染

```ts
const html = mdToHtml(markdown); // 用 remark + rehype
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setContent(`<html><head><style>${css}</style></head><body>${html}</body></html>`);
const pdf = await page.pdf({ format: 'A4', printBackground: true });
await browser.close();
return pdf;
```

worker 镜像已含 chromium → puppeteer-core 复用。

## 涉及文件

```
packages/services/src/reports/sla-report-service.ts
packages/services/src/reports/md-template.ts
packages/services/src/reports/pdf-renderer.ts
packages/db/src/repositories/uptime-repo.ts                # 加 aggregateForRange / responsePercentiles
packages/db/src/repositories/alert-repo.ts                  # 加 summarize
packages/db/src/repositories/metrics-repo.ts                # 加 cwvTrend
apps/web/app/api/v1/sites/[id]/reports/sla/route.ts
apps/web/app/(dashboard)/sites/[id]/reports/page.tsx
apps/web/components/report-period-picker.tsx
apps/web/package.json                                       # +puppeteer-core +remark
docs/17-sla-reports.md
```

## 验收标准

- [ ] 单测：generate() 返回正确聚合
- [ ] `curl /api/v1/sites/{id}/reports/sla?from=...&to=...&format=md` 返回 Markdown
- [ ] `format=pdf` 返回 application/pdf，可下载
- [ ] 同一时间窗 24h 内重复请求命中 cache（用 Redis ETag）
- [ ] UI 选时间 → 一键下载
- [ ] viewer / operator 仅 read，admin 可 regenerate（绕过 cache）
- [ ] `pnpm -r typecheck && lint && test` 全绿
