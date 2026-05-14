# 任务总览

> 所有开发按任务推进。每个任务一份独立 Markdown，遵循统一模板，完成后在本索引勾选。
> 任务 ID 永不复用。若取消某任务，保留编号并标 `Cancelled`。

## 任务模板（新任务必须照写）

```markdown
# T<NN> — <标题>

- **里程碑**：M<n>
- **优先级**：P0 / P1 / P2
- **前置依赖**：T<NN>, T<NN>
- **预估工时**：X h
- **负责人**：（单人项目留空）
- **状态**：Todo / In Progress / Blocked / Done / Cancelled

## 目标

一句话说明该任务要达成什么。

## 范围

- 包含
- 不包含（显式排除）

## 设计要点

（接口签名、数据流、关键算法、重要取舍）

## 涉及文件

- `apps/web/...`
- `packages/db/...`

## 验收标准

- [ ] 可在本地 `pnpm dev` 下手动走通 ...
- [ ] 单元测试覆盖 ...
- [ ] CI 全绿

## 备注
```

---

## 里程碑与进度

图例：⬜ Todo ／ 🟡 In Progress ／ ✅ Done ／ 🚫 Cancelled

### M0 · 基础设施（P0，约 16h）

| ID                                                 | 标题                                  | 状态 | 前置     |
| -------------------------------------------------- | ------------------------------------- | ---- | -------- |
| [T01](./M0-foundation/T01-monorepo-setup.md)       | Monorepo 骨架与工具链                 | ✅   | —        |
| [T02](./M0-foundation/T02-docker-compose-infra.md) | Dev/Prod Docker Compose               | ✅   | T01      |
| [T03](./M0-foundation/T03-database-schema.md)      | Drizzle schema + 首次迁移             | ✅   | T01      |
| [T04](./M0-foundation/T04-shared-packages.md)      | `@siteops/shared` + `services` 初始化 | ✅   | T01, T03 |
| [T05](./M0-foundation/T05-ci-pipeline.md)          | GitHub Actions CI                     | ✅   | T01      |

**里程碑完成条件**：`pnpm install && pnpm dev` 起得来；DB/Redis docker 跑得起来；CI 五项全绿；`packages/db` 能 seed 出 admin 用户。

---

### M1 · 核心管理（P0，约 30h）

| ID                                          | 标题                             | 状态 | 前置 |
| ------------------------------------------- | -------------------------------- | ---- | ---- |
| [T06](./M1-core/T06-auth-system.md)         | Auth.js 单 admin 登录            | ✅   | T04  |
| [T07](./M1-core/T07-app-shell.md)           | Dashboard 壳子（布局/侧栏/主题） | ✅   | T06  |
| [T08](./M1-core/T08-site-registry.md)       | 站点注册表（CRUD + 列表 + 详情） | ✅   | T07  |
| [T09](./M1-core/T09-domain-management.md)   | 域名管理与到期提醒（数据层）     | ✅   | T08  |
| [T10](./M1-core/T10-deployment-tracking.md) | 部署记录接收与时间线             | ✅   | T08  |

**里程碑完成条件**：登录后可录入站点、关联域名、手动上报部署记录并在 UI 看到时间线。

---

### M2 · 监控与审计（P1，约 36h）

| ID                                              | 标题                                | 状态 | 前置          |
| ----------------------------------------------- | ----------------------------------- | ---- | ------------- |
| [T11](./M2-monitoring/T11-uptime-checks.md)     | Uptime 定时检查                     | ✅   | T02, T08      |
| [T12](./M2-monitoring/T12-ssl-domain-expiry.md) | SSL 与域名到期巡检                  | ✅   | T09           |
| [T13](./M2-monitoring/T13-seo-checks.md)        | SEO 自动审计（meta/sitemap/robots） | ✅   | T08           |
| [T14](./M2-monitoring/T14-lighthouse-audit.md)  | Lighthouse 跑分入库                 | ✅   | T13           |
| [T15](./M2-monitoring/T15-error-tracking.md)    | 错误聚合接收端                      | ✅   | T08           |
| [T16](./M2-monitoring/T16-alert-channels.md)    | 告警规则引擎 + 通道                 | ✅   | T11, T12, T15 |

**里程碑完成条件**：10 个站点并发 uptime 不堆积；每日自动 SEO+Lighthouse；任何失败触发至少一种通道告警。

---

### M3 · 外部集成（P1，约 30h）

| ID                                                     | 标题                          | 状态 | 前置 |
| ------------------------------------------------------ | ----------------------------- | ---- | ---- |
| [T17](./M3-integrations/T17-cloudflare-integration.md) | Cloudflare 账号/项目/部署同步 | ✅   | T10  |
| [T18](./M3-integrations/T18-github-integration.md)     | GitHub 仓库/Actions 同步      | ✅   | T10  |
| [T19](./M3-integrations/T19-google-analytics.md)       | GA4 Data API PV/UV 拉取       | ✅   | T08  |
| [T20](./M3-integrations/T20-search-console.md)         | Search Console 数据同步       | ✅   | T08  |
| [T21](./M3-integrations/T21-adsense-integration.md)    | AdSense Management API 同步   | ✅   | T08  |

---

### M4 · 商业化看板（P2，约 18h）

| ID                                           | 标题                             | 状态 | 前置     |
| -------------------------------------------- | -------------------------------- | ---- | -------- |
| [T22](./M4-revenue/T22-traffic-dashboard.md) | 流量看板（单站 + 全局）          | ⬜   | T19, T20 |
| [T23](./M4-revenue/T23-revenue-dashboard.md) | 收入看板（Ads + Affiliate 手动） | ⬜   | T21      |
| [T24](./M4-revenue/T24-roi-evaluation.md)    | ROI 计算与低效站点识别           | ⬜   | T22, T23 |

里程碑概览见 [`M4-revenue/README.md`](./M4-revenue/README.md)。

**里程碑完成条件**：3 个新仪表盘（流量 / 收入 / ROI）可用；联盟收入与月度成本均可手动 CRUD；ROI < 0 的站点能在排行表里识别出来。

---

### M5 · 自动化对接（P2，约 18h）

| ID                                                | 标题                                | 状态 | 前置     |
| ------------------------------------------------- | ----------------------------------- | ---- | -------- |
| [T25](./M5-automation/T25-task-queue-api.md)      | Task Queue REST 接口（给 Agent 用） | ⬜   | T06, T08 |
| [T26](./M5-automation/T26-agent-runs-tracking.md) | Agent 调用审计表与看板              | ⬜   | T25      |
| [T27](./M5-automation/T27-webhook-receiver.md)    | CF/GitHub webhook 接收              | ⬜   | T17, T18 |

---

## 依赖关系图（粗）

```
T01 ── T02 ── T11
 │      │      │
 ├─ T03 ──┬─ T04 ─ T06 ─ T07 ─ T08 ─┬─ T09 ─ T12 ─┐
 │        │                         │              │
 │        │                         ├─ T10 ─ T17 ──┤
 │        │                         │      └ T18   │
 │        │                         │              │
 │        │                         ├─ T13 ─ T14   │
 │        │                         ├─ T15         │
 │        │                         ├─ T19 ─ T22   ├─ T16
 │        │                         ├─ T20 ─ T22   │
 │        │                         └─ T21 ─ T23   │
 │        │                                        │
 └─ T05   └─ T25 ─ T26                  T17/T18 ─ T27
                                                └─ T24
```

## 估时汇总

| 里程碑 | 估时 |  累计 |
| ------ | ---: | ----: |
| M0     | 16 h |  16 h |
| M1     | 30 h |  46 h |
| M2     | 36 h |  82 h |
| M3     | 30 h | 112 h |
| M4     | 18 h | 130 h |
| M5     | 18 h | 148 h |

按每天有效 5h、每周 5 天 → ~6 周完成全部 5 个里程碑。MVP 核心（M0+M1+M2）约 3.2 周。
