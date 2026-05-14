# T02 — Dev/Prod Docker Compose

- **里程碑**：M0
- **优先级**：P0
- **前置依赖**：T01
- **预估工时**：3h
- **状态**：Done

## 目标

提供两套 docker-compose：dev 只起依赖（Postgres + Redis），prod 起完整服务（pg + redis + web + worker + caddy）。

## 范围

**包含**

- `infra/docker-compose.dev.yml`
- `infra/docker-compose.yml`（prod）
- `infra/Dockerfile.web`（多阶段构建）
- `infra/Dockerfile.worker`
- `infra/caddy/Caddyfile`（默认配置：反向代理 web + 自动 HTTPS）
- 健康检查（healthcheck）
- 持久卷（pg-data、redis-data、caddy-data、lighthouse-data）
- `.env.example` 补全所有必要变量

**不包含**

- K8s manifest
- 多机部署
- 数据库主从

## 设计要点

- 镜像：`postgres:16-alpine`、`redis:7-alpine`、`caddy:2`，web/worker 自构建。
- 网络：单 bridge network `siteops-net`。
- Postgres：`POSTGRES_DB=siteops`、`POSTGRES_USER=siteops`、`POSTGRES_PASSWORD` 从 env 注入。
- Redis：`requirepass` 从 env 注入。
- Web 容器：`CMD ["node", "apps/web/server.js"]`（Next.js standalone 输出）。
- Worker 容器：`CMD ["node", "apps/worker/dist/index.js"]`。
- 启动顺序：postgres/redis healthy 后再起 web/worker（`depends_on.condition: service_healthy`）。
- Caddy：仅在生产用；dev 直连 3000。
- Lighthouse 需要 chromium：在 `Dockerfile.worker` 中安装 `chromium` 与必要依赖（`-no-sandbox` 由 worker 代码处理）。

## 涉及文件

```
infra/docker-compose.dev.yml
infra/docker-compose.yml
infra/Dockerfile.web
infra/Dockerfile.worker
infra/caddy/Caddyfile
infra/.dockerignore
.env.example                 # 追加：POSTGRES_PASSWORD, REDIS_PASSWORD 等
```

## 验收标准

- [x] `docker compose -f infra/docker-compose.dev.yml up -d` 起 pg + redis，healthcheck 都通过
- [x] `docker compose -f infra/docker-compose.yml build` 成功（即使业务代码还是空，构建脚手架要通过）
- [x] `docker compose -f infra/docker-compose.yml up -d` 后 `curl http://localhost/healthz` 经 caddy 返回 200
- [x] 关停后 `up` 数据保持（pg-data 卷有效）

## 备注

- Caddy 自动 HTTPS 需要域名；本地 dev 可用 `tls internal` 或 HTTP only。
- prod compose 文件里把端口绑回 `127.0.0.1`（pg/redis），仅 caddy 暴露公网。
- Web/worker 暂用占位 entrypoint（`apps/web/server.placeholder.cjs` 仅响应 `/healthz`；`apps/worker/runner.placeholder.cjs` 仅做 keepalive）；T07 / T11 落地真正的 Next.js / BullMQ 入口时一并替换。
- Dockerfile 内置国内镜像加速：`ALPINE_MIRROR=https://mirrors.aliyun.com/alpine`、`NPM_REGISTRY=https://registry.npmmirror.com`、`COREPACK_NPM_REGISTRY` 一并指向 npmmirror；海外构建可通过 `--build-arg` 覆盖回上游。
- 端口冲突时通过环境变量覆盖：`POSTGRES_PORT` / `REDIS_PORT` / `CADDY_HTTP_PORT` / `CADDY_HTTPS_PORT`（验收时本机 80/6379 已被占用，用 18080/26379 跑通）。
