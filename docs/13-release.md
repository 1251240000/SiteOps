# 13 · Release pipeline

> 多站点平台从代码到生产镜像的发版流程。CI 工作流见
> `.github/workflows/ci.yml`，发版工作流见 `.github/workflows/release.yml`。

## 1. 方案速览

| 项目           | 当前选型                                                         |
| -------------- | ---------------------------------------------------------------- |
| 版本号         | SemVer：`vMAJOR.MINOR.PATCH[-PRERELEASE]`，MVP 期保持 `v0.x.y`   |
| 触发方式       | git push tag `v*.*.*`（或 `workflow_dispatch` 手动重跑指定 tag） |
| 构建产物       | 多架构（linux/amd64 + linux/arm64）OCI 镜像                      |
| 发布位置       | GHCR：`ghcr.io/<owner>/siteops-web` / `siteops-worker`           |
| `:latest`      | 仅在「干净 SemVer」（无 `-rc` / `-beta`）时自动指向最新 tag      |
| GitHub Release | 自动创建，正文用 GitHub 自动 changelog（PR title）+ 镜像引用     |
| 不在范围       | 自动 semver bump、自动部署、镜像签名（cosign）、SBOM             |

> 想升级到 cosign 签名 + SBOM 时，只需在 `release.yml` 里追加
> `cosign sign-blob` 步骤，不影响现有 4 步发版流程。

## 2. 发版前置条件

- `main` 分支 CI 全绿（lint/typecheck/test:coverage/build/smoke 五项）。
- 最近一次推送的 commit 在 GitHub Actions 上能看到一个绿色 `CI` 工作流。
- 仓库 `Settings → Actions → General → Workflow permissions` 至少为
  「Read and write permissions」（`release.yml` 用 `GITHUB_TOKEN` 推 GHCR
  和创建 Release，需要 `packages: write` + `contents: write`，job 级别已
  声明，但仓库级总开关不能是 read-only）。
- 仓库可见性是 public 时 GHCR 镜像默认 public；private 仓库默认 private。
  ops 第一次 pull 前需要 `docker login ghcr.io -u <user> -p <PAT>`，PAT 至
  少需要 `read:packages`。

## 3. 发版四步

```bash
# 0) 在 main 上、CI 绿、想发的 commit 处
git checkout main
git pull --ff-only

# 1) 打 tag
#    正式版：v0.1.0
#    预发版：v0.1.0-rc.1（不会更新 :latest）
git tag -a v0.1.0 -m "release: v0.1.0"
git push origin v0.1.0

# 2) 等 release 工作流跑完
#    https://github.com/<owner>/siteops/actions/workflows/release.yml
#    通常 8–15min（cold cache，arm64 是慢的那一边）

# 3) 验证镜像
docker buildx imagetools inspect ghcr.io/<owner>/siteops-web:v0.1.0
docker buildx imagetools inspect ghcr.io/<owner>/siteops-worker:v0.1.0
# 期望看到两个 manifest：linux/amd64, linux/arm64

# 4) 在生产 host 上滚动到新版本
ssh prod
cd /opt/siteops
# 推荐做法：把 tag 写进 .env，docker compose 自动拉
sed -i 's|^SITEOPS_WEB_IMAGE=.*|SITEOPS_WEB_IMAGE=ghcr.io/<owner>/siteops-web:v0.1.0|'   .env
sed -i 's|^SITEOPS_WORKER_IMAGE=.*|SITEOPS_WORKER_IMAGE=ghcr.io/<owner>/siteops-worker:v0.1.0|' .env
docker compose -f infra/docker-compose.yml pull web worker
docker compose -f infra/docker-compose.yml up -d web worker
# 健康检查：Caddy 走 /readyz 切流（T29），containers 起来 60s 内会切完
curl -fsS https://<domain>/readyz
```

> `:latest` 也会被同步，所以「永远跑最新稳定版」的环境可以不动 `.env`，
> 直接 `docker compose pull && up -d`。

## 4. 工作流串联

```
push tag v0.1.0
        │
        ▼
release.yml ─ build-and-push (matrix: web | worker)
                │       │
                │       └── docker buildx ── ghcr.io/<owner>/siteops-web:v0.1.0
                │                            ghcr.io/<owner>/siteops-web:latest（仅干净 SemVer）
                │
                └── needs: github-release ── softprops/action-gh-release
                                              └── GitHub Release page + auto changelog
```

并行点：`siteops-web` 与 `siteops-worker` 两个镜像由 matrix 同时构建；
`fail-fast: false` 让其中一个失败时另一个仍然完成，便于一次性看清两边的
状态。

## 5. 预发版 / RC 流程

```bash
git tag -a v0.2.0-rc.1 -m "release: v0.2.0-rc.1"
git push origin v0.2.0-rc.1
```

行为差异：

- 镜像 tag **只**写 `:v0.2.0-rc.1`，不动 `:latest`。
- GitHub Release 会被标记为 prerelease（不会出现在仓库主页的
  "Latest release" 卡上）。
- 验证完毕后，按 §3 重新打 `v0.2.0` 即可推正式版。

## 6. 回滚

镜像 push 后 GHCR 不会自动覆盖（除了 `:latest`），所以回滚只是把生产
`docker-compose` 的镜像 tag 切到上一版：

```bash
ssh prod
cd /opt/siteops
sed -i 's|:v0.2.0|:v0.1.0|g' .env
docker compose -f infra/docker-compose.yml pull web worker
docker compose -f infra/docker-compose.yml up -d web worker
```

如果新版本带了 DB 迁移，回滚前先确认 `packages/db/migrations/` 里新加的
迁移是否能向后兼容；不能兼容的需要先跑 `restore.sh`（见
`docs/12-backup-restore.md`）。

## 7. CI 端的护栏（T50）

- `pnpm test:coverage` 在 `ci.yml` 里跑，每个 workspace 的
  `vitest.config.ts` 各自定义了 v8 coverage threshold；任一包低于阈值
  CI fail。
- `pnpm --filter @siteops/web test:e2e:smoke` 在 `ci.yml` 里跑（< 5min），
  只跑 spec 标题包含 `@smoke` 的用例。完整 Playwright 套件每天 03:30 UTC
  由 `e2e.yml` 触发。
- coverage 报告作为 artifact 上传到每次 CI run（保留 7 天），失败时还会
  上传 Playwright HTML 报告。

写新 e2e 用例时，如果它属于「合并到 main 不能挂的核心路径」，在 `test()`
标题里加 `@smoke`；其他用例保持普通 spec，由夜跑覆盖。

## 8. 故障排查

| 现象                            | 排查方向                                                                 |
| ------------------------------- | ------------------------------------------------------------------------ |
| `release.yml` 卡在 buildx arm64 | 多半是 CN 镜像源在国外 runner 上慢；workflow 已注入官方 mirror，重试即可 |
| GHCR push 403                   | 仓库总权限设为 read-only；改 `Settings → Actions → General`              |
| Release page 没创建             | tag 不是 `v*.*.*` 格式（`workflow_dispatch` 也只认 SemVer）              |
| `docker compose pull` 报 unauth | 仓库私有时 ops 没 `docker login ghcr.io`                                 |
| 多架构 manifest 缺 arm64        | buildx 没启动 QEMU；手动重跑 `workflow_dispatch` 选同一 tag              |
| smoke 用例在 PR 上 flake        | 在 `apps/web/playwright.config.ts` 把 `retries` 调高，先稳               |
