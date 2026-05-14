# M4 · 商业化看板

> 让运营数据 ↔ 收入 ↔ 成本 在一个面板上闭环：知道哪些站赚钱、哪些站亏钱、为什么。

## 里程碑目标

把 M3 已经写入数据库的三张原始表（`metrics_daily` / `search_console_daily` / `adsense_daily`）变成可消费的运营视图，并补齐"成本"和"手动联盟收入"这两个 MVP 不可少的人工数据维度。完成后：

1. **流量**：单站和全局都能看 7/30/90 天的 PV / UV / Sessions / Bounce 曲线，叠加 GSC 的 impressions / clicks / 平均排名。
2. **收入**：AdSense 自动同步 + 联盟人工录入 → 统一 `revenue_usd` 视图（按日 / 按月）。
3. **成本与 ROI**：站点月度成本录入 → 自动算 30 天 ROI = (revenue − cost) / cost；低效站点（ROI < 0 或 RPM 持续走低）进入"待处理"清单。

## 任务清单

| ID                                | 标题                             | 状态 | 估时 | 前置     |
| --------------------------------- | -------------------------------- | ---- | ---: | -------- |
| [T22](./T22-traffic-dashboard.md) | 流量看板（单站 + 全局）          | ✅   |  8 h | T19, T20 |
| [T23](./T23-revenue-dashboard.md) | 收入看板（Ads + Affiliate 手动） | ✅   |  6 h | T21      |
| [T24](./T24-roi-evaluation.md)    | ROI 计算与低效站点识别           | ⬜   |  4 h | T22, T23 |

## 数据流概览

```
  GA4 / Plausible (M3:T19) ──► metrics_daily ──┐
  GSC             (M3:T20) ──► search_console_daily ──┤
                                                      ├──► trafficService   (T22)
                                                      │
  AdSense         (M3:T21) ──► adsense_daily ─────────┤
  手动录入        (T23)    ──► affiliate_entries ─────┼──► revenueService   (T23)
                                                      │
  手动录入        (T24)    ──► site_costs ────────────┤
                                                      └──► roiService       (T24)
```

所有聚合都走 service 层而不是直接在 route handler 里写 SQL，方便单元测试和将来给 agent / API key 调用复用。

## 新增数据表

| 表名                | 任务 | 用途                                       |
| ------------------- | ---- | ------------------------------------------ |
| `affiliate_entries` | T23  | 联盟收入人工录入（按周期 + 项目）          |
| `site_costs`        | T24  | 站点月度成本（hosting / domain / content） |

均带 `(site_id, period)` 唯一索引和 audit 字段；迁移分别走 `0004_affiliate_entries.sql`、`0005_site_costs.sql`。

## 不在 M4 范围

- 移动端 / PWA 适配
- 收入预测、AI 建议生成（放 M5 / 后续 agent 任务）
- 多币种汇率服务（沿用 T21 的固定汇率，加 `// TODO: real FX`）
- 历史报表导出（CSV / PDF）

## 里程碑完成条件

- [ ] `/(dashboard)/traffic`、`/(dashboard)/revenue`、`/(dashboard)/roi` 三个页面在 `pnpm dev` 下可用
- [ ] 至少一个真实站点的 30 天数据可以从原始表渲染到图表（无需 mock）
- [ ] 联盟收入 + 成本录入双向 CRUD 走通
- [ ] ROI 排序表能识别并高亮 ROI < 0 的站点
- [ ] 全部新增 service 走单元测试，`pnpm -r test` 全绿
