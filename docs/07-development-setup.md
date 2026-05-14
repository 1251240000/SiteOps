# 07 · 开发环境

## 1. 前置要求

| 工具             | 版本   | 安装                                                         |
| ---------------- | ------ | ------------------------------------------------------------ |
| Node.js          | 20 LTS | nvm / fnm                                                    |
| pnpm             | 9.x    | `corepack enable && corepack prepare pnpm@latest --activate` |
| Docker           | 24+    | 官方                                                         |
| Docker Compose   | v2     | docker 自带                                                  |
| Git              | 2.40+  |                                                              |
| Chromium（可选） | 最新   | Lighthouse 用；CI 走 Playwright 自带                         |

## 2. 首次启动

```bash
git clone <repo> siteops
cd siteops
cp .env.example .env.local      # 填关键变量

# 启动依赖（Postgres + Redis）
docker compose -f infra/docker-compose.dev.yml up -d

# 安装依赖
pnpm install

# DB 迁移
pnpm --filter @siteops/db migrate

# 种子数据（创建 admin 用户）
pnpm --filter @siteops/db seed

# 启动 web + worker（并行）
pnpm dev
```

浏览器打开 http://localhost:3000，用 `.env.local` 中的 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录。

## 3. 必填环境变量

| 变量             | 说明                                                |
| ---------------- | --------------------------------------------------- |
| `DATABASE_URL`   | `postgres://siteops:siteops@localhost:5432/siteops` |
| `REDIS_URL`      | `redis://localhost:6379`                            |
| `AUTH_SECRET`    | `openssl rand -base64 32`                           |
| `ADMIN_EMAIL`    | seed 时创建的管理员邮箱                             |
| `ADMIN_PASSWORD` | seed 用，仅首次生效                                 |
| `NODE_ENV`       | `development` / `production`                        |
| `LOG_LEVEL`      | `debug` / `info` / `warn` / `error`                 |

可选（M3 后）：

| 变量                       | 说明                          |
| -------------------------- | ----------------------------- |
| `CF_API_TOKEN`             | Cloudflare scoped token       |
| `GH_TOKEN`                 | GitHub PAT                    |
| `GA4_SERVICE_ACCOUNT_JSON` | base64 编码的 service account |
| `GSC_OAUTH_*`              | Search Console OAuth client   |
| `ADSENSE_OAUTH_*`          | AdSense OAuth client          |

## 4. 常用脚本（根目录）

| 命令               | 说明                                |
| ------------------ | ----------------------------------- |
| `pnpm dev`         | 同时启动 web 与 worker（Turborepo） |
| `pnpm build`       | 构建所有包                          |
| `pnpm lint`        | 全仓 lint                           |
| `pnpm typecheck`   | tsc --noEmit 全仓                   |
| `pnpm test`        | Vitest 全仓                         |
| `pnpm test:e2e`    | Playwright                          |
| `pnpm db:generate` | drizzle-kit 生成迁移                |
| `pnpm db:migrate`  | 应用迁移                            |
| `pnpm db:studio`   | drizzle-kit studio                  |
| `pnpm format`      | prettier 格式化全仓                 |

## 5. 调试

- VS Code：仓库内提供 `.vscode/launch.json`，可分别附加到 web（Next.js）与 worker。
- DB：用 `pnpm db:studio` 或任意 PG 客户端（DBeaver/TablePlus）。
- Redis：`docker exec -it siteops-redis redis-cli`。
- BullMQ Board：dev 模式下 `apps/web` 暴露 `/admin/queues`（Bull-Board，仅 admin 可访问）。

## 6. 端口

| 服务                   | 端口 |
| ---------------------- | ---- |
| web                    | 3000 |
| worker metrics（可选） | 3001 |
| Postgres               | 5432 |
| Redis                  | 6379 |

## 7. 重置环境

```bash
docker compose -f infra/docker-compose.dev.yml down -v   # 含数据卷
pnpm clean
rm -rf .turbo node_modules
pnpm install
```

## 8. 常见问题

- **Auth.js 重定向到 localhost:3000/api/auth/error**：检查 `AUTH_SECRET`、`NEXTAUTH_URL`（dev 自动推断，prod 必填）。
- **drizzle-kit generate 没产物**：确认 schema 文件路径配在 `drizzle.config.ts`。
- **Lighthouse 在 docker 里跑不起来**：dev 阶段建议本地直接跑 worker；生产用 `--no-sandbox` 或 sidecar 容器。
