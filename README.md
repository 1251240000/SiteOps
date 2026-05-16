# SiteOps

> 多站点统一运维管理平台，用于集中管理站点、域名、部署、健康监控、SEO/性能审计、错误告警、流量与收入数据。

SiteOps 是一个基于 `pnpm workspaces` 与 `Turborepo` 的 TypeScript monorepo。仓库包含 Next.js Web 控制台、BullMQ Worker、Drizzle/PostgreSQL 数据层、业务服务层与外部平台集成模块。

## 功能概览

- **站点管理**：维护站点档案、状态、元信息与站点详情页。
- **域名与 SSL**：跟踪域名配置、到期时间与证书状态。
- **部署追踪**：记录部署历史、状态、提交信息与关联站点。
- **监控与审计**：支持 uptime 检查、SEO 审计、Lighthouse 性能报告。
- **告警中心**：管理告警规则、通知渠道、告警确认与测试发送。
- **外部集成**：Cloudflare、GitHub、GA4、Plausible、Search Console、AdSense。
- **商业化看板**：聚合流量、收入、成本与 ROI 指标。

## 技术栈

| 分类       | 技术选型                                        |
| ---------- | ----------------------------------------------- |
| Monorepo   | pnpm 9 + Turborepo                              |
| 语言       | TypeScript 5                                    |
| Web        | Next.js 15 App Router + React 19 + Tailwind CSS |
| UI         | Radix UI + shadcn/ui 风格组件 + Lucide Icons    |
| 数据请求   | TanStack Query / TanStack Table                 |
| API        | Next.js Route Handlers                          |
| 鉴权       | Auth.js v5                                      |
| 数据库     | PostgreSQL 16 + Drizzle ORM                     |
| 缓存与队列 | Redis 7 + BullMQ                                |
| 校验       | Zod                                             |
| 日志       | pino                                            |
| 测试       | Vitest                                          |
| 部署       | Docker Compose + Caddy + Web/Worker 独立镜像    |

## 目录结构

```text
siteops/
├── apps/
│   ├── web/                 # Next.js 控制台与 API
│   └── worker/              # BullMQ 调度器与后台任务
├── packages/
│   ├── db/                  # Drizzle schema、migrations、repositories、DB scripts
│   ├── services/            # 业务逻辑层
│   ├── integrations/        # 外部平台 API 客户端
│   ├── shared/              # 通用 schema、类型、工具、日志与错误
│   ├── config-eslint/       # 共享 ESLint 配置
│   └── config-typescript/   # 共享 TypeScript 配置
├── infra/
│   ├── docker-compose.dev.yml
│   ├── docker-compose.yml
│   ├── Dockerfile.web
│   ├── Dockerfile.worker
│   └── caddy/
├── docs/                    # 架构、技术栈、API、开发规范等文档
├── tasks/                   # 任务拆分与里程碑文档
├── .env.example             # 环境变量示例
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

## 快速开始

### 1. 前置要求

- **Node.js**：`>=20.0.0`
- **pnpm**：`9.12.3`
- **Docker**：建议 24+
- **Docker Compose**：v2

### 2. 准备环境变量

```bash
cp .env.example .env.local
```

至少确认以下变量可用：

```env
DATABASE_URL=postgres://siteops:siteops@localhost:5432/siteops
REDIS_URL=redis://localhost:6379
AUTH_SECRET=replace-me-with-strong-random
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=ChangeMe123!
```

生产环境请使用强随机密钥：

```bash
openssl rand -base64 32
```

### 3. 启动本地依赖

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

该命令会启动：

- **PostgreSQL**：`localhost:5432`
- **Redis**：`localhost:6379`

### 4. 安装依赖

```bash
pnpm install
```

### 5. 初始化数据库

```bash
pnpm --filter @siteops/db db:migrate
pnpm --filter @siteops/db db:seed
```

`db:seed` 会根据 `.env.local` 中的 `ADMIN_EMAIL` 与 `ADMIN_PASSWORD` 创建管理员账号。

### 6. 启动开发服务

```bash
pnpm dev
```

`pnpm dev` 通过 Turborepo 同时拉起 web 和 worker。需要先把 `.env.local`
的变量 export 到当前 shell（例如 `set -a; . ./.env.local; set +a`）。
Web 在 dev 模式下走 [Turbopack](https://nextjs.org/docs/app/api-reference/turbopack)，
首次编译显著快于 Webpack；生产构建（`pnpm build`）仍走 Webpack，链路不变。

> 通过 LAN IP 或自定义域名访问时，把 `NEXT_DEV_ALLOWED_ORIGINS=10.1.1.10`
> （多个用逗号分隔）写进 `.env.local`，可避免 Next 15 的 `Cross origin
request detected` 警告。

默认访问地址：

- **Web 控制台**：http://localhost:3000
- **登录账号**：`.env.local` 中的 `ADMIN_EMAIL`
- **登录密码**：`.env.local` 中的 `ADMIN_PASSWORD`

## 常用命令

### 根目录命令

| 命令                | 说明                        |
| ------------------- | --------------------------- |
| `pnpm dev`          | 通过 Turborepo 启动开发服务 |
| `pnpm build`        | 构建所有 app 与 package     |
| `pnpm lint`         | 运行全仓 ESLint             |
| `pnpm typecheck`    | 运行全仓 TypeScript 检查    |
| `pnpm test`         | 运行全仓测试                |
| `pnpm format`       | 使用 Prettier 格式化全仓    |
| `pnpm format:check` | 检查格式化状态              |

### 数据库命令

| 命令                                    | 说明                    |
| --------------------------------------- | ----------------------- |
| `pnpm --filter @siteops/db db:generate` | 生成 Drizzle migration  |
| `pnpm --filter @siteops/db db:migrate`  | 执行数据库迁移          |
| `pnpm --filter @siteops/db db:seed`     | 初始化管理员账号        |
| `pnpm --filter @siteops/db db:studio`   | 打开 Drizzle Studio     |
| `pnpm --filter @siteops/db db:drop`     | 删除迁移状态/数据库对象 |

### 单应用命令

| 命令                                  | 说明          |
| ------------------------------------- | ------------- |
| `pnpm --filter @siteops/web dev`      | 仅启动 Web    |
| `pnpm --filter @siteops/web build`    | 构建 Web      |
| `pnpm --filter @siteops/worker dev`   | 仅启动 Worker |
| `pnpm --filter @siteops/worker build` | 构建 Worker   |

## 环境变量

完整示例见 [`.env.example`](./.env.example)。

### 核心变量

| 变量                          | 说明                         |
| ----------------------------- | ---------------------------- |
| `NODE_ENV`                    | `development` / `production` |
| `LOG_LEVEL`                   | 日志级别                     |
| `DATABASE_URL`                | PostgreSQL 连接字符串        |
| `REDIS_URL`                   | Redis 连接字符串             |
| `AUTH_SECRET`                 | Auth.js 加密密钥             |
| `AUTH_URL`                    | 生产环境站点 URL             |
| `ADMIN_EMAIL`                 | seed 阶段创建的管理员邮箱    |
| `ADMIN_PASSWORD`              | seed 阶段创建的管理员密码    |
| `ALERT_CIPHER_KEY`            | 生产环境告警渠道加密密钥     |
| `UPTIME_DEFAULT_INTERVAL_MIN` | 默认 uptime 检查间隔         |

### 集成变量

| 变量                          | 说明                    |
| ----------------------------- | ----------------------- |
| `CF_API_TOKEN`                | Cloudflare API Token    |
| `GH_TOKEN`                    | GitHub Personal Token   |
| `GA4_SERVICE_ACCOUNT_JSON`    | GA4 Service Account     |
| `PLAUSIBLE_API_KEY`           | Plausible API Key       |
| `GSC_OAUTH_CLIENT_ID`         | Search Console OAuth ID |
| `GSC_OAUTH_CLIENT_SECRET`     | Search Console Secret   |
| `ADSENSE_OAUTH_CLIENT_ID`     | AdSense OAuth ID        |
| `ADSENSE_OAUTH_CLIENT_SECRET` | AdSense OAuth Secret    |
| `ADSENSE_ACCOUNT_NAME`        | AdSense account name    |

## 本地依赖管理

启动开发依赖：

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

停止开发依赖并保留数据：

```bash
docker compose -f infra/docker-compose.dev.yml down
```

停止开发依赖并删除数据卷：

```bash
docker compose -f infra/docker-compose.dev.yml down -v
```

## 生产部署

生产部署配置位于 [`infra/docker-compose.yml`](./infra/docker-compose.yml)，包含：

- **postgres**：PostgreSQL 数据库
- **redis**：Redis 缓存与 BullMQ 队列
- **web**：Next.js Web 服务
- **worker**：后台任务处理进程
- **caddy**：反向代理与 TLS 入口

示例：

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml build
docker compose -f infra/docker-compose.yml up -d
```

生产环境至少需要配置：

- **`POSTGRES_PASSWORD`**
- **`REDIS_PASSWORD`**
- **`AUTH_SECRET`**
- **`ALERT_CIPHER_KEY`**
- **`SITEOPS_DOMAIN`**

## 文档导航

| 文档                                                               | 说明                       |
| ------------------------------------------------------------------ | -------------------------- |
| [feasibility_study_260512.md](./feasibility_study_260512.md)       | 可行性研究                 |
| [docs/00-overview.md](./docs/00-overview.md)                       | 平台目标、范围与非目标     |
| [docs/01-architecture.md](./docs/01-architecture.md)               | 系统组件、数据流与部署拓扑 |
| [docs/02-tech-stack.md](./docs/02-tech-stack.md)                   | 技术栈与选型理由           |
| [docs/03-data-model.md](./docs/03-data-model.md)                   | 数据模型                   |
| [docs/04-api-spec.md](./docs/04-api-spec.md)                       | API 契约                   |
| [docs/05-coding-standards.md](./docs/05-coding-standards.md)       | 编码规范                   |
| [docs/06-git-workflow.md](./docs/06-git-workflow.md)               | Git 工作流                 |
| [docs/07-development-setup.md](./docs/07-development-setup.md)     | 开发环境说明               |
| [docs/08-directory-structure.md](./docs/08-directory-structure.md) | 目录结构约定               |
| [docs/09-testing-strategy.md](./docs/09-testing-strategy.md)       | 测试策略                   |
| [tasks/README.md](./tasks/README.md)                               | 任务与里程碑               |

## 开发原则

1. **数据先入库**：部署、流量、收入、错误、告警等外部数据先持久化，再进入看板。
2. **Web 与 Worker 分离**：交互请求走 Web/API，周期任务与外部同步走 Worker。
3. **服务层承载业务逻辑**：API route 负责鉴权、参数校验与响应封装，核心逻辑放在 `packages/services`。
4. **共享契约优先**：跨 app/package 的类型、schema、常量优先沉淀到 `packages/shared`。
5. **可观测性内建**：后台任务、外部 API 调用与关键业务流程使用结构化日志。

## 当前状态

- **已具备**：基础设施、Web 控制台、鉴权、站点/域名/部署管理、监控审计、告警、外部集成、流量/收入/ROI 看板。
- **后续方向**：自动化对接、智能周报、推荐操作与 agent 执行记录。
