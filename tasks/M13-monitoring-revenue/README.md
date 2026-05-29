# M13 · 监控与商业化增强

> 把已有"基础指标采集"升级为更贴近运营决策的能力：合成监控、SLA 报告、CWV 趋势、联盟自动化、收入风险告警。

## 里程碑目标

5 个针对运营痛点的能力，外加一个自研数据采集底座：

1. **Synthetic transactions**：超出 GET / 探活，跑用户提交的 Playwright 多步骤脚本（"登录 → 下单 → 校验 JSON"）。
2. **SLA / Uptime 报告**：按月生成 PDF / Markdown SLA 报告（含 uptime %、平均响应、关键 alerts）。
3. **CWV 趋势图**：Lighthouse 数据已有，但缺时间维度拐点视图，admin 一眼看出 "3 月哪天 LCP 飙升"。
4. **联盟收入自动化**：现状 affiliate_entries 手动；接 Amazon Associates / ShareASale reporting API。
5. **预算 + A/B 实验**：site_costs 超阈值告警；站点端 SDK 给 `track(experimentId, variant, conversion)`。
6. **自研前端埋点**：浏览器 SDK + collect API 补齐 GA4 不可用、延迟或被拦截时的 PV/UV/RUM 数据。

## 任务清单

| ID                                             | 标题                             | 状态 | 估时 | 前置     |
| ---------------------------------------------- | -------------------------------- | ---- | ---: | -------- |
| [T55](./T55-synthetic-monitoring.md)           | Synthetic transaction monitoring | ⬜   |  8 h | T11      |
| [T56](./T56-sla-report-generation.md)          | SLA / Uptime 报告生成            | ⬜   |  6 h | T11, T22 |
| [T57](./T57-cwv-trend-chart.md)                | Core Web Vitals 趋势图           | ⬜   |  4 h | T14      |
| [T58](./T58-affiliate-autoingest.md)           | 联盟收入自动抓取                 | ⬜   |  5 h | T23      |
| [T59](./T59-budget-alert-ab-tracking.md)       | 预算告警 + A/B 实验跟踪          | ⬜   |  3 h | T23, T16 |
| [T64](./T64-self-hosted-frontend-analytics.md) | 自研前端埋点 SDK + RUM 采集      | ⬜   |  6 h | T08, T22 |

## 不在 M13 范围

- 更多 ads network（Mediavine、Ezoic 等）
- 邮件订阅报告自动发送（dashboard 下载即可）
- 实验结果显著性分析（v2）

## 里程碑完成条件

- [ ] 一个 Playwright synthetic 脚本能上传 + 调度跑 + 失败入 alerts
- [ ] `/(dashboard)/sites/[id]/reports` 可下载本月 SLA PDF
- [ ] CWV 折线图能看到任意时间窗（7d / 30d / 90d）的 LCP/CLS/INP
- [ ] Amazon Associates 接入后每天自动写入 affiliate_entries
- [ ] site_costs > 阈值触发 alert；A/B `/track` 端点能接受 SDK 上报
- [ ] 自研前端埋点 SDK 能采集 PV/UV/session 与 RUM p75，并在 analytics 页展示
- [ ] `pnpm -r typecheck && lint && test` 全绿
