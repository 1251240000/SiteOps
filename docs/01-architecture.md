# 01 · 系统架构

## 1. 顶层架构图

```
                                        ┌──────────────────┐
                                        │  Browser (admin) │
                                        └────────┬─────────┘
                                                 │ HTTPS
                                ┌────────────────▼────────────────┐
                                │       Next.js (apps/web)         │
                                │  ┌────────────────────────────┐ │
                                │  │ App Router pages (RSC)     │ │
                                │  │ Route Handlers (REST API)  │ │
                                │  │ Auth.js (admin session)    │ │
                                │  └────────────────────────────┘ │
                                └────┬───────────┬────────────────┘
                                     │           │
                       ┌─────────────┘           └────────────┐
                       │                                      │
                ┌──────▼───────┐                       ┌──────▼──────┐
                │  PostgreSQL  │◄──────────────────────│    Redis    │
                │ (Drizzle)    │     read/write        │  (BullMQ)   │
                └──────▲───────┘                       └──────▲──────┘
                       │                                      │
                       │ read/write                           │ enqueue/consume
                       │                                      │
              ┌────────┴──────────────────────────────────────┘
              │
       ┌──────▼─────────────────────────────────────────┐
       │            Worker (apps/worker)                 │
       │  ┌────────────────────────────────────────────┐ │
       │  │ Schedulers (BullMQ repeatable jobs)        │ │
       │  │   - uptime-check    (every 5 min)          │ │
       │  │   - seo-audit       (daily)                │ │
       │  │   - lighthouse-run  (daily, staggered)     │ │
       │  │   - ssl-domain-expiry (daily)              │ │
       │  │   - analytics-sync  (hourly)               │ │
       │  │   - search-console-sync (daily)            │ │
       │  │   - adsense-sync    (daily)                │ │
       │  └────────────────────────────────────────────┘ │
       │  ┌────────────────────────────────────────────┐ │
       │  │ Processors (per job type)                  │ │
       │  └────────────────────────────────────────────┘ │
       └────┬───────────────────────────────────────────┘
            │ HTTP / API
            ▼
   ┌─────────────────────────────────────────────────┐
   │   外部系统：Cloudflare / GitHub / GA4 / GSC /    │
   │            AdSense / 被管站点 HTTP 端点            │
   └─────────────────────────────────────────────────┘
```

## 2. 进程拓扑（docker-compose）

| 容器            | 镜像               | 端口           | 说明                         |
| --------------- | ------------------ | -------------- | ---------------------------- |
| `web`           | 自构建（Node 20）  | 3000           | Next.js（前端 + API + Auth） |
| `worker`        | 自构建（Node 20）  | —              | BullMQ scheduler + processor |
| `postgres`      | postgres:16-alpine | 5432（仅内网） | 主数据库                     |
| `redis`         | redis:7-alpine     | 6379（仅内网） | 队列与缓存                   |
| `caddy`（可选） | caddy:2            | 80/443         | 反向代理 + 自动 HTTPS        |

> MVP 单机部署。未来需要扩容时，`worker` 可水平扩展（BullMQ 天然支持多消费者）。

## 3. 模块边界

### 3.1 `apps/web`

- **职责**：UI、API、鉴权、SSR/RSC 渲染。
- **不做**：长任务（>5s）、定时任务、外部 API 同步。所有耗时工作派发到 `worker`。
- **规则**：API Route Handler 只做参数校验 → 调 `packages/services` → 返回。不直接 import `apps/worker`。

### 3.2 `apps/worker`

- **职责**：执行所有 BullMQ 任务（健康检查、SEO 审计、外部同步）。
- **不做**：暴露 HTTP 端口（除 `/healthz`）。不直接渲染 UI。
- **可水平扩展**：所有 job 必须幂等。

### 3.3 `packages/db`

- **职责**：Drizzle schema、migrations、数据库 client 工厂。
- **唯一可以写 SQL 的地方**：仓储层（repository）模式。

### 3.4 `packages/services`

- **职责**：业务逻辑（站点 CRUD、告警判定、ROI 计算）。
- **依赖**：`packages/db`、`packages/integrations`、`packages/shared`。
- **被谁用**：`apps/web` 的 API 路由、`apps/worker` 的 job processor。

### 3.5 `packages/integrations`

- **职责**：外部 API 封装（Cloudflare、GitHub、GA4、GSC、AdSense、Lighthouse runner）。
- **规则**：每个集成一个子目录，对外暴露统一接口；内部自管 token 刷新、重试、限流。

### 3.6 `packages/shared`

- **职责**：跨包共享的 Zod schema、类型、常量、工具函数。
- **零运行时依赖**（除 zod、date-fns 等纯函数库）。

### 3.7 `packages/ui`（可选，后期再拆）

- **职责**：跨 app 复用的 React 组件。MVP 阶段直接放在 `apps/web/components`，后期复用需求出现后再抽。

## 4. 数据流：典型场景

### 4.1 注册新站点

```
admin → POST /api/sites
      → validateZod(payload)
      → siteService.create()
      → db.insert(sites)
      → enqueue('uptime-check', { siteId, immediate: true })
      → enqueue('seo-audit', { siteId })
      → return 201
```

### 4.2 Uptime 检查（每 5 分钟）

```
BullMQ scheduler → uptime-check job
  ├─ 取所有 enabled=true 的 sites
  ├─ 并发（限流）请求每个 site.url
  ├─ 写 uptime_checks 表
  ├─ 若连续失败 N 次 → enqueue 'alert-fire'
  └─ 更新 sites.health_score
```

### 4.3 Lighthouse 审计（每天）

```
scheduler → lighthouse-run job (per site, staggered)
  ├─ 启动 chromium（lighthouse npm package）
  ├─ 跑 4 个 category
  ├─ 写 audit_runs + audit_metrics 表
  └─ 若 Performance < 阈值 → 'alert-fire'
```

## 5. 鉴权与会话

- **MVP**：单 admin。Auth.js v5 + Credentials Provider，密码哈希存 `users` 表（仅 1 行）。
- **API 调用**：浏览器走 cookie session；外部 Agent 通过 `X-Api-Key` header（值存 `api_keys` 表，bcrypt 哈希）。
- **CSRF**：Next.js Auth.js 内置；外部 API 用 API key，无需 CSRF。

## 6. 错误处理与可观测性

- **结构化日志**：pino，输出 JSON 到 stdout，由 Docker 收集。
- **请求 ID**：每个 API 请求生成 `requestId`，贯穿日志。
- **Job 追踪**：每个 BullMQ job 记录 `jobId, attempts, durationMs, error`。
- **失败重试**：job 默认 3 次指数退避；超限后入 `failed_jobs` 表供人工查看。

## 7. 配置与密钥

- 所有密钥（DB 密码、Redis 密码、外部 API token）走环境变量。
- 提供 `.env.example`，密钥分组：`DB_*`、`REDIS_*`、`AUTH_*`、`CF_*`、`GH_*`、`GA_*`、`GSC_*`、`ADSENSE_*`。
- 严禁把密钥写入数据库明文；必要时用对称加密（key 来自环境变量）。

## 8. 演进路径

| 阶段              | 触发条件              | 演进动作                                     |
| ----------------- | --------------------- | -------------------------------------------- |
| 单机 → 多 worker  | 站点 > 50 或 job 堆积 | docker-compose scale worker                  |
| 单 admin → 多用户 | 团队协作需求          | 引入 RBAC + Auth.js OAuth provider           |
| 自托管 → 云原生   | 数据量大              | DB 改 Neon/RDS，Redis 改 Upstash，部署改 K8s |
| REST → 加 GraphQL | Agent 查询变复杂      | 在 `apps/web` 上叠 `/graphql`                |
