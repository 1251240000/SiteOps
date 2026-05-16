# 02 · 技术栈选型

> 选型原则：**成熟优先、TypeScript 优先、单仓单语言、能 self-host**。任何一项选择必须在 1 个月内能找到 ≥3 个可运行参考项目。

## 1. 锁定版本（MVP）

| 类别         | 选择                    | 版本             | 备注                           |
| ------------ | ----------------------- | ---------------- | ------------------------------ |
| 语言         | TypeScript              | 5.6+             | `strict: true`                 |
| 运行时       | Node.js                 | 20 LTS           | Dockerfile 用 `node:20-alpine` |
| 包管理       | pnpm                    | 9.x              | workspace                      |
| 任务编排     | Turborepo               | 2.x              | 增量构建、缓存                 |
| Web 框架     | Next.js                 | 15（App Router） | RSC + Route Handlers           |
| UI 框架      | React                   | 19               | 与 Next.js 15 配套             |
| 样式         | Tailwind CSS            | 3.4              | + CSS Variables                |
| 组件库       | shadcn/ui               | 最新             | 复制源码而非 npm 包            |
| 图标         | lucide-react            | 最新             |                                |
| 表单         | react-hook-form         | 7.x              | + Zod resolver                 |
| 数据请求     | TanStack Query          | 5.x              | 客户端缓存                     |
| 表格         | TanStack Table          | 8.x              | headless                       |
| 图表         | Recharts                | 2.x              | 简单足够；复杂图后续换 ECharts |
| 鉴权         | Auth.js (NextAuth)      | 5（beta 稳定后） | Credentials provider           |
| i18n         | next-intl               | 3.x              | dashboard UI（zh-CN + en-US）  |
| 校验         | Zod                     | 3.23+            | 共享 schema                    |
| 数据库       | PostgreSQL              | 16               | Docker                         |
| ORM          | Drizzle ORM             | 最新             | 类型安全、轻量、SQL 友好       |
| 迁移         | drizzle-kit             | 最新             |                                |
| 队列         | BullMQ                  | 5.x              |                                |
| 队列依赖     | Redis                   | 7                |                                |
| 日志         | pino                    | 9.x              | + pino-pretty（dev）           |
| 测试（单元） | Vitest                  | 2.x              |                                |
| 测试（E2E）  | Playwright              | 最新             |                                |
| Lint         | ESLint                  | 9                | flat config                    |
| 格式化       | Prettier                | 3.x              |                                |
| Git hooks    | husky + lint-staged     | 最新             |                                |
| 提交规范     | commitlint              | 最新             | conventional commits           |
| 容器         | Docker / docker-compose | 最新             |                                |
| 反向代理     | Caddy 2                 | 可选             | 自动 HTTPS                     |

## 2. 关键选型决策（为何不选 X）

### 2.1 Drizzle vs Prisma

- **选 Drizzle**：编译期类型推导、生成 SQL 透明、运行时无 query engine 二进制（Prisma 在 Alpine 偶有问题）、迁移产物即纯 SQL（便于运维 review）。
- Prisma 的 Studio 很好用，但我们会自己做 Dashboard，不依赖 Studio。

### 2.2 BullMQ vs Temporal/Inngest/Trigger.dev

- **选 BullMQ**：自托管、零云依赖、Redis 已经在栈里。Temporal 太重；Inngest/Trigger.dev 是托管服务，与"自托管"原则冲突。
- 后期若 workflow 复杂度上升（多步骤、跨天补偿），可在 BullMQ 之上加薄状态机层，或迁移 Temporal。

### 2.3 Next.js Route Handlers vs 独立 API（NestJS/Fastify）

- **选 Next.js Route Handlers**：MVP 接口数量有限（<50 个），合并到 `apps/web` 减少进程与部署单元。
- 业务逻辑全部抽到 `packages/services`，将来切到独立后端只需换一层 transport。

### 2.4 Auth.js v5 vs Lucia vs 自写

- **选 Auth.js v5**：生态最大，未来加 OAuth provider（Google/GitHub）成本最低。
- 单 admin 场景下额外复杂度可接受。

### 2.5 shadcn/ui vs MUI/Antd/Mantine

- **选 shadcn/ui**：源码复制到本仓库，可改可拆；与 Tailwind 体系一致；包体小。
- MUI/Antd 设计语言重，Mantine 也不错但生态略小。

### 2.6 Recharts vs Chart.js vs ECharts

- **选 Recharts**：React 原生、声明式、足够 MVP。复杂仪表盘后期可加 ECharts。

### 2.7 Vitest vs Jest

- **选 Vitest**：原生 ESM、与 Vite 配套、Next.js 15 项目集成更顺。

### 2.8 next-intl vs i18next / react-intl

- **选 next-intl**：App Router + RSC 一等公民，server 组件直接 `await getTranslations()`，无需 hydrate dance；文件体积小、ICU MessageFormat 原生支持。
- 路由策略：cookie 驱动（`localePrefix: 'never'`），不引 `[locale]/...` 段——保护 M1–M5 已稳定的 75+ 路由文件；后端 API message 保持英文（机器消费契约）。
- 详见 T28（`tasks/M6-polish/T28-i18n-dashboard.md`）。

## 3. 不引入的库（MVP）

| 库                       | 不引入原因                                             |
| ------------------------ | ------------------------------------------------------ |
| Redux / Zustand          | TanStack Query + URL state 已够                        |
| GraphQL（Apollo / urql） | REST 足够，Agent 集成更简单                            |
| tRPC                     | 与 Auth.js + Route Handlers 组合复杂度上升；需要时再加 |
| Storybook                | 组件量小，先靠 shadcn/ui 自带 demo                     |
| Sentry                   | 自建错误聚合表先用着；流量上来再接                     |
| Tailwind CSS v4          | 仍在 alpha，等稳定                                     |

## 4. 外部服务依赖

| 服务                        | 用途                              | MVP 必需？ | 备注                  |
| --------------------------- | --------------------------------- | ---------- | --------------------- |
| Cloudflare API              | 域名、Pages 项目、Worker 配置读取 | 否（M3）   | token scope 最小化    |
| GitHub API                  | 仓库列表、commit、Actions run     | 否（M3）   | PAT 或 GitHub App     |
| Google Analytics 4 Data API | PV/UV                             | 否（M3）   | service account       |
| Google Search Console API   | 展示/点击                         | 否（M3）   | OAuth                 |
| AdSense Management API      | 收入                              | 否（M3）   | OAuth                 |
| Lighthouse                  | 性能审计                          | M2         | 本地 chromium，不走云 |

## 5. 浏览器与兼容性

- 仅支持 admin 自己的浏览器：Chrome/Edge/Firefox 最新 2 个大版本。
- 不考虑 IE、移动端深度适配（dashboard 仅桌面端使用）。

## 6. 性能目标（运维平台自身）

- API p95 < 300ms（不含外部同步任务）
- Dashboard 首屏 LCP < 2.5s
- Worker 单 job 平均执行 < 30s（Lighthouse 例外，约 30–60s）
- 单机吞吐：100 站点 × 5min uptime check = 1200 次/小时 → BullMQ 完全 cover
