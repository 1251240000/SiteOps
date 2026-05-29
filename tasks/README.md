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
| [T22](./M4-revenue/T22-traffic-dashboard.md) | 流量看板（单站 + 全局）          | ✅   | T19, T20 |
| [T23](./M4-revenue/T23-revenue-dashboard.md) | 收入看板（Ads + Affiliate 手动） | ✅   | T21      |
| [T24](./M4-revenue/T24-roi-evaluation.md)    | ROI 计算与低效站点识别           | ✅   | T22, T23 |

里程碑概览见 [`M4-revenue/README.md`](./M4-revenue/README.md)。

**里程碑完成条件**：3 个新仪表盘（流量 / 收入 / ROI）可用；联盟收入与月度成本均可手动 CRUD；ROI < 0 的站点能在排行表里识别出来。

---

### M5 · 自动化对接（P2，约 18h）

| ID                                                | 标题                                | 状态 | 前置     |
| ------------------------------------------------- | ----------------------------------- | ---- | -------- |
| [T25](./M5-automation/T25-task-queue-api.md)      | Task Queue REST 接口（给 Agent 用） | ✅   | T06, T08 |
| [T26](./M5-automation/T26-agent-runs-tracking.md) | Agent 调用审计表与看板              | ✅   | T25      |
| [T27](./M5-automation/T27-webhook-receiver.md)    | CF/GitHub webhook 接收              | ✅   | T17, T18 |

里程碑概览见 [`M5-automation/README.md`](./M5-automation/README.md)。

**里程碑完成条件**：`POST /tasks` → `POST /tasks/claim` → `complete` 端到端走通；`/agent-runs` 仪表盘展示真实调用与 p95 latency；CF/GH webhook 实事件能签名校验入库并落到 `deployments`。

---

### M6 · 体验打磨（P2，约 6h）

| ID                                       | 标题                                 | 状态 | 前置 |
| ---------------------------------------- | ------------------------------------ | ---- | ---- |
| [T28](./M6-polish/T28-i18n-dashboard.md) | Dashboard UI 国际化（zh-CN + en-US） | ✅   | T07  |

里程碑概览见 [`M6-polish/README.md`](./M6-polish/README.md)。后续 a11y、移动端、OpenAPI client、命令面板等「非新功能但提升使用质感」的工作都会落在这里。

**里程碑完成条件**：dashboard 默认 zh-CN 且顶栏可切 en-US；两份 catalog key 集合一致；e2e 套件强制 en-US cookie 后仍全绿。

---

### M7 · 平台健壮性（P0，约 24h）

| ID                                                    | 标题                                | 状态 | 前置 |
| ----------------------------------------------------- | ----------------------------------- | ---- | ---- |
| [T29](./M7-hardening/T29-readiness-probe.md)          | 就绪探针 `/readyz` + Caddy 健康切换 | ✅   | T02  |
| [T30](./M7-hardening/T30-api-key-cache.md)            | API Key 校验缓存层                  | ✅   | T06  |
| [T31](./M7-hardening/T31-rate-limit-degraded.md)      | Bad-sig / 限流路径进程内降级        | ✅   | T27  |
| [T32](./M7-hardening/T32-worker-graceful-shutdown.md) | Worker 优雅退出 + drain             | ✅   | T11  |
| [T33](./M7-hardening/T33-security-headers.md)         | 安全响应头（HSTS / CSP / XFO）      | ✅   | T02  |
| [T34](./M7-hardening/T34-task-queue-perf.md)          | Task Queue 索引与 sweep 性能        | ✅   | T25  |

里程碑概览见 [`M7-hardening/README.md`](./M7-hardening/README.md)。

**里程碑完成条件**：`/readyz` 在依赖故障时返回 503；API key 校验缓存命中 ≥ 99%；Redis 宕机时本地 LRU 兜底；worker drain 工作；安全响应头全注入；task 1000 行 sweep < 200ms。

---

### M8 · API 契约与一致性（P1，约 30h）

| ID                                                         | 标题                                  | 状态 | 前置     |
| ---------------------------------------------------------- | ------------------------------------- | ---- | -------- |
| [T35](./M8-api-contract/T35-openapi-generation.md)         | OpenAPI 生成 + Swagger UI + CI parity | ✅   | T25, T27 |
| [T36](./M8-api-contract/T36-cursor-pagination.md)          | Cursor 分页迁移（高频长表）           | ✅   | T11, T26 |
| [T37](./M8-api-contract/T37-idempotency-key-middleware.md) | Idempotency-Key HTTP 中间件           | ✅   | T06      |
| [T38](./M8-api-contract/T38-api-key-rate-override.md)      | API Key 自定义限流 + system 端点      | ✅   | T06, T11 |
| [T39](./M8-api-contract/T39-bull-board-admin.md)           | Bull-Board 队列管理面板               | ✅   | T11      |

里程碑概览见 [`M8-api-contract/README.md`](./M8-api-contract/README.md)。

**里程碑完成条件**：`/api/v1/openapi.json` 覆盖全部路由；高频表 cursor 分页生效；`Idempotency-Key` 重试不重复创建；API key 自定义限流可用；`/admin/queues` Bull-Board 上线。

---

### M9 · 多用户与认证安全（P1，约 28h）

| ID                                                    | 标题                | 状态 | 前置 |
| ----------------------------------------------------- | ------------------- | ---- | ---- |
| [T40](./M9-multi-user/T40-users-rbac.md)              | Users + RBAC        | ✅   | T06  |
| [T41](./M9-multi-user/T41-totp-2fa.md)                | TOTP 二次验证       | ⬜   | T40  |
| [T42](./M9-multi-user/T42-action-audit-log.md)        | 管理动作审计日志    | ⬜   | T40  |
| [T43](./M9-multi-user/T43-webhook-secret-rotation.md) | Webhook secret 旋转 | ⬜   | T27  |

里程碑概览见 [`M9-multi-user/README.md`](./M9-multi-user/README.md)。

**里程碑完成条件**：多角色登录 + 邀请；admin 可启用 TOTP；管理动作全审计；webhook secret 可滚动 7 天。

---

### M10 · 通知与外发（P1，约 20h）

| ID                                                    | 标题                              | 状态 | 前置     |
| ----------------------------------------------------- | --------------------------------- | ---- | -------- |
| [T44](./M10-notifications/T44-email-notifier-real.md) | Email 通知器真实化（Resend/SMTP） | ✅   | T16      |
| [T45](./M10-notifications/T45-outbound-webhook.md)    | Outbound Webhook 通道             | ⬜   | T11, T16 |
| [T46](./M10-notifications/T46-error-pii-sampling.md)  | 错误聚合 PII 脱敏与采样配置       | ⬜   | T15      |

里程碑概览见 [`M10-notifications/README.md`](./M10-notifications/README.md)。

**里程碑完成条件**：邮件真发；客户配 outbound webhook URL 能收到 HMAC 签名事件；error_configs 脱敏与采样配置生效。

---

### M11 · 可观测性与运维（P1，约 22h）

| ID                                                      | 标题                              | 状态 | 前置 |
| ------------------------------------------------------- | --------------------------------- | ---- | ---- |
| [T47](./M11-observability/T47-metrics-otel-exporter.md) | Prometheus + OpenTelemetry 导出器 | ⬜   | T11  |
| [T48](./M11-observability/T48-platform-sentry.md)       | 平台自身错误监控接 Sentry         | ⬜   | T01  |
| [T49](./M11-observability/T49-db-backup-restore.md)     | DB 备份与恢复方案                 | ✅   | T02  |
| [T50](./M11-observability/T50-release-pipeline.md)      | Release pipeline + CI 升级        | ✅   | T05  |

里程碑概览见 [`M11-observability/README.md`](./M11-observability/README.md)。

**里程碑完成条件**：web+worker 暴露 `/metrics`；OTel 推到 collector；Sentry 收到平台异常；DB 备份/恢复演练绿；tag 推 GHCR 自动出镜像。

---

### M12 · Agent 生态（P2，约 28h）

| ID                                                     | 标题                           | 状态 | 前置     |
| ------------------------------------------------------ | ------------------------------ | ---- | -------- |
| [T51](./M12-agent-ecosystem/T51-agent-sdk.md)          | `@siteops/agent` SDK 包        | ⬜   | T25, T35 |
| [T52](./M12-agent-ecosystem/T52-task-orchestration.md) | Task 编排（DAG / cron / push） | ⬜   | T25, T34 |
| [T53](./M12-agent-ecosystem/T53-task-ui-replay.md)     | Task 录入 / 重放 / 批量 UI     | ⬜   | T25      |
| [T54](./M12-agent-ecosystem/T54-agent-fleet-view.md)   | Agent fleet 视图 + 心跳        | ⬜   | T26      |

里程碑概览见 [`M12-agent-ecosystem/README.md`](./M12-agent-ecosystem/README.md)。

**里程碑完成条件**：SDK 10 行可用；父子任务级联；cron 模板每分钟实例化；dashboard 可建/重放/批改任务；`/agents` 显示 fleet。

---

### M13 · 监控与商业化增强（P2，约 32h）

| ID                                                                    | 标题                             | 状态 | 前置     |
| --------------------------------------------------------------------- | -------------------------------- | ---- | -------- |
| [T55](./M13-monitoring-revenue/T55-synthetic-monitoring.md)           | Synthetic transaction monitoring | ⬜   | T11      |
| [T56](./M13-monitoring-revenue/T56-sla-report-generation.md)          | SLA / Uptime 报告生成            | ⬜   | T11, T22 |
| [T57](./M13-monitoring-revenue/T57-cwv-trend-chart.md)                | Core Web Vitals 趋势图           | ⬜   | T14      |
| [T58](./M13-monitoring-revenue/T58-affiliate-autoingest.md)           | 联盟收入自动抓取                 | ⬜   | T23      |
| [T59](./M13-monitoring-revenue/T59-budget-alert-ab-tracking.md)       | 预算告警 + A/B 实验跟踪          | ⬜   | T23, T16 |
| [T64](./M13-monitoring-revenue/T64-self-hosted-frontend-analytics.md) | 自研前端埋点 SDK + RUM 采集      | ⬜   | T08, T22 |

里程碑概览见 [`M13-monitoring-revenue/README.md`](./M13-monitoring-revenue/README.md)。

**里程碑完成条件**：synthetic 脚本可跑 + 失败告警；SLA PDF 可下载；CWV 趋势图上线；Amazon/ShareASale 自动抓取；budget alert + A/B `/track` 端点可用；自研埋点 SDK 能采集 PV/UV/session 与 RUM p75。

---

### M14 · UX 与长期债务（P2，约 17h）

| ID                                                    | 标题                                       | 状态 | 前置 |
| ----------------------------------------------------- | ------------------------------------------ | ---- | ---- |
| [T60](./M14-ux-debt/T60-command-palette-home.md)      | 命令面板（⌘K）+ Dashboard 首页自定义       | ⬜   | T07  |
| [T61](./M14-ux-debt/T61-mobile-a11y-locale.md)        | 移动响应式 + a11y + Locale 扩展（ja / tw） | ⬜   | T28  |
| [T62](./M14-ux-debt/T62-config-storage.md)            | ROI 阈值可配置 + Storage 抽象 + Argon2id   | ⬜   | T24  |
| [T63](./M14-ux-debt/T63-polish-currency-cache-rtl.md) | 多币种 + 缓存策略 + 组件 RTL 测试          | ⬜   | T23  |

里程碑概览见 [`M14-ux-debt/README.md`](./M14-ux-debt/README.md)。

**里程碑完成条件**：⌘K 全局搜索可用；首页可拖拽；iPhone SE 视口主流页可用；ja/tw catalog 完整；ROI 阈值 UI 可调；S3 存储可启用；密码 / API key 升级到 Argon2id。

---

## 依赖关系图（粗）

### MVP 主线（M0–M6，已完成）

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
                              T07 ─ T28
```

### 后续主线（M7–M14）

```
M7 平台健壮性
  T02 ─ T29 (readyz)
  T02 ─ T33 (security headers)
  T06 ─ T30 (api-key cache)
  T11 ─ T32 (worker drain)
  T25 ─ T34 (task queue perf)
  T27 ─ T31 (rate-limit fallback)

M8 API 契约（依赖 M7 不强制，但建议先做完 M7）
  T25/T27 ─ T35 (openapi)
  T11/T26 ─ T36 (cursor pagination)
  T06     ─ T37 (idempotency)
  T06/T11 ─ T38 (apikey rate / system)
  T11     ─ T39 (bull-board)

M9 多用户
  T06 ─ T40 ─┬─ T41 (TOTP)
             └─ T42 (audit)
  T27 ─ T43 (webhook secret rotation)

M10 通知
  T16 ─ T44 (email real)
  T11/T16 ─ T45 (outbound webhook)
  T15     ─ T46 (PII redact)

M11 可观测
  T11 ─ T47 (otel/prom)
  T01 ─ T48 (sentry)
  T02 ─ T49 (db backup)
  T05 ─ T50 (release pipeline)

M12 Agent 生态
  T25 + T35 ─ T51 (agent SDK)
  T25 + T34 ─ T52 (orchestration)
  T25       ─ T53 (task UI)
  T26       ─ T54 (fleet view)

M13 监控/收入增强
  T11        ─ T55 (synthetic)
  T11/T22    ─ T56 (SLA report)
  T14        ─ T57 (CWV trend)
  T23        ─ T58 (affiliate auto)
  T23/T16    ─ T59 (budget + A/B)
  T08/T22    ─ T64 (self-hosted frontend analytics)

M14 UX & 长期债务
  T07 ─ T60 (cmdk + home)
  T28 ─ T61 (mobile/a11y/locale)
  T24 ─ T62 (config + storage + argon2)
  T23 ─ T63 (currency + cache + RTL)
```

跨里程碑硬性前置：T35（OpenAPI）建议先于 T51（Agent SDK），后者用前者生成类型；T40（RBAC）先于 T41/T42 — 角色概念是 2FA 与 audit log 的前提。其他里程碑之间无强依赖，可并行排期。

## 估时汇总

| 里程碑 | 主题             | 估时 |  累计 | 状态 |
| ------ | ---------------- | ---: | ----: | ---- |
| M0     | 基础设施         | 16 h |  16 h | ✅   |
| M1     | 核心管理         | 30 h |  46 h | ✅   |
| M2     | 监控与审计       | 36 h |  82 h | ✅   |
| M3     | 外部集成         | 30 h | 112 h | ✅   |
| M4     | 商业化看板       | 18 h | 130 h | ✅   |
| M5     | 自动化对接       | 18 h | 148 h | ✅   |
| M6     | 体验打磨（i18n） |  6 h | 154 h | ✅   |
| M7     | 平台健壮性       | 24 h | 178 h | ⬜   |
| M8     | API 契约一致性   | 30 h | 208 h | ⬜   |
| M9     | 多用户与认证安全 | 28 h | 236 h | ⬜   |
| M10    | 通知与外发       | 20 h | 256 h | ⬜   |
| M11    | 可观测性与运维   | 22 h | 278 h | ⬜   |
| M12    | Agent 生态       | 28 h | 306 h | ⬜   |
| M13    | 监控/商业化增强  | 32 h | 338 h | ⬜   |
| M14    | UX 与长期债务    | 17 h | 355 h | ⬜   |

按每天有效 5h、每周 5 天计：

- **MVP 主线（M0–M6）**：154 h ≈ 6.2 周（已完成）
- **后续主线（M7–M14）**：201 h ≈ 8.0 周
- **总计**：355 h ≈ 14.2 周

推荐推进顺序：**M7 → M8 → M9 → M10 / M11（可并行）→ M12 → M13 → M14**。M7–M11 是平台进入"可长期托管运行"的硬基线，建议优先；M12–M14 是业务能力扩展与体验提升，按运营优先级排。
