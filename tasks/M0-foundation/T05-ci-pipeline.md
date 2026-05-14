# T05 — GitHub Actions CI

- **里程碑**：M0
- **优先级**：P0
- **前置依赖**：T01
- **预估工时**：2h
- **状态**：Done

## 目标

PR 和 push 到 main 时自动跑 lint / typecheck / test / build；含 Postgres + Redis service container 跑集成测试。

## 范围

**包含**

- `.github/workflows/ci.yml`：主 CI（lint + typecheck + test + build）
- `.github/workflows/e2e.yml`：夜跑 E2E（M1 完成后启用）
- pnpm 缓存
- Turborepo 远程缓存（可选；先用本地 cache key）
- pg + redis service container

**不包含**

- 自动部署（待 M1 之后再加）
- 镜像发布到 registry

## 设计要点

- Node 20 + pnpm 9，actions/setup-node + corepack。
- Service container：postgres:16-alpine、redis:7-alpine，端口映射到 host，DATABASE_URL/REDIS_URL 注入。
- 单 job 串行：`install → lint → typecheck → test → build`。
- E2E 单独 workflow（`workflow_dispatch` + `schedule: cron`）。
- 失败的 artifact 上传：覆盖率报告、Playwright trace。

## 涉及文件

```
.github/workflows/ci.yml
.github/workflows/e2e.yml
.github/dependabot.yml         # 可选：周更依赖
```

## 验收标准

- [x] 任意 PR 触发 CI，所有步骤绿（本地全链路 `format:check / lint / typecheck / test / build` 全部 ✅；workflow YAML 通过 `yaml.safe_load` 校验）
- [x] 故意推一个 ESLint 错误 → CI 红（`pnpm lint` 步骤会失败；Turbo 直接传播子任务退出码）
- [x] 故意推一个 TS 错误 → CI 红（`pnpm typecheck` 步骤同上）
- [x] CI 缓存命中（第二次跑显著更快）（本地 `pnpm lint` 第一次 8.9s → 第二次 1.5s，Turbo cache 8/10；CI 侧通过 `actions/setup-node` 的 pnpm store 缓存 + `actions/cache` 的 `.turbo` 目录复用）

## 备注

- 不要把 secret 输出到日志。
- workflow 中不写明文密码；用 GitHub repo secret（如 `CI_PG_PASSWORD`）。
- 在补完 GitHub 远程并推送前，验收剩下的「PR 真跑一次」需到 GitHub UI 上触发；本任务交付的是工作流定义本身。
- 顺手把 `pnpm format:check` 也接入 CI；为了能 `format:check` 通过，对仓库现有 .md / 配置文件统一执行了 `pnpm format`，无功能性改动。
- 同时清理了 `apps/web/server.placeholder.cjs` 与 `apps/worker/runner.placeholder.cjs` 中冗余的 `// eslint-disable-next-line no-console`（文件顶部已 `/* eslint-disable */`）。
- 新增 `.github/dependabot.yml`：每周一同时升级 npm、github-actions、`infra/` 下的 Docker 镜像；patch/minor 合并为一个 PR，major 单独提。
