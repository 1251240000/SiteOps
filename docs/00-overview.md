# 00 · 平台概述

## 1. 一句话定位

> SiteOps 是“站点工厂”的运维中枢：把分散在 Cloudflare、GitHub、Google Analytics、Search Console、AdSense 等平台的数据收口，对每个被管站点提供统一的注册、监控、审计、收入与告警视图。

## 2. 服务对象

- **当前**：单个 admin（站点工厂运营者本人）。
- **未来**：自动化 Agent（作为系统账号，通过 API 写入部署记录、读取站点元数据）。

## 3. MVP 范围（必须包含）

| 能力             | 说明                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| 站点注册表       | 站点元数据（域名、国家、语言、类型、技术栈、Git 仓库、CF 项目、Analytics ID 等）的 CRUD |
| 域名管理         | 域名所属站点、注册商、到期时间、SSL 状态                                                |
| 部署跟踪         | 每次部署的 commit、状态、耗时、构建日志 URL                                             |
| Uptime 监控      | 定时 HTTP 健康检查、状态码、响应时间、连续失败次数                                      |
| SSL/域名到期提醒 | 距到期 N 天告警                                                                         |
| SEO 自动审计     | sitemap、robots、title/description、canonical、hreflang、OG 检测                        |
| 性能审计         | Lighthouse 跑分（Performance/SEO/Best Practices/Accessibility）入库                     |
| 错误聚合         | JS 错误、构建失败、API 错误（先做接收 + 列表，不做完整 APM）                            |
| 告警通道         | Webhook（飞书/钉钉/Slack/Telegram 任一）+ 邮件占位                                      |
| 流量数据         | Google Analytics 4 / Plausible 拉取 PV/UV                                               |
| 搜索数据         | Search Console 展示量、点击量、CTR、平均排名                                            |
| 收入数据         | AdSense 收入、Affiliate 手动登记（API 集成可选）                                        |
| Dashboard        | 站点列表 + 单站点详情 + 全局 KPI                                                        |
| 鉴权             | 单 admin 账号 + Session                                                                 |

## 4. 非目标（MVP 不做）

- 多租户、多团队、复杂 RBAC（仅 admin 一人）
- UGC、评论、用户系统
- 完整 APM（Sentry/DataDog 级别的错误堆栈/性能追踪）
- 站点自动开发与代码生成（属于站点工厂 Agent 系统，不属于本平台）
- 域名自动购买、AdSense 自动申请
- 内置可视化 SQL 查询/BI 工具

## 5. 与站点工厂其他子系统的边界

```
                    ┌─────────────────────────┐
                    │   SiteOps（本平台）      │
                    │  注册表 / 监控 / 看板     │
                    └────────┬────────────────┘
                             │ REST API + DB
            ┌────────────────┼────────────────────┐
            │                │                    │
   ┌────────▼─────┐  ┌──────▼────────┐  ┌────────▼────────┐
   │ Trend Agent  │  │ Builder Agent │  │ QA / Deploy Bot │
   │ (热点采集)   │  │ (站点生成)     │  │ (验收/部署)      │
   └──────────────┘  └───────────────┘  └─────────────────┘
        ▲                  ▲                     ▲
        │                  │                     │
   外部数据源          GitHub/CF API          Lighthouse/E2E
```

- **本平台只做"中枢 + 看板"**，不直接写站点代码。
- Agent 通过 API 把站点、部署、错误、收入数据写入本平台。
- 反过来，Agent 通过 API 读取站点列表、配置、健康状态作为决策输入。

## 6. 成功标准（MVP）

- 在一台 2C4G 服务器上 docker-compose 一键启动。
- 注册 ≥ 10 个真实站点，自动每 5 分钟 uptime 检查、每天 SEO/Lighthouse 审计一次。
- 任意站点宕机或证书过期 7 天内能收到告警。
- Dashboard 能在一屏内看出"哪些站点有问题、哪些站点赚钱"。
- 全部 API 有 OpenAPI 文档（或 Zod schema 自动生成）。
