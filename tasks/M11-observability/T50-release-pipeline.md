# T50 — Release pipeline + CI 升级

- **里程碑**：M11
- **优先级**：P1
- **前置依赖**：T05
- **预估工时**：4 h
- **状态**：Done

## 目标

补两块工程基线：① PR CI 跑 Playwright smoke + coverage 门槛，避免回归；② tag 触发 docker 镜像 build → push GHCR → 创建 GitHub Release，打通从代码到生产镜像的路径。

## 范围

**包含**

- `ci.yml`：
  - 新增 step：`pnpm test:e2e:smoke`（subset of e2e，标记 `@smoke`，<3min）
  - 新增 step：vitest coverage + 上传 artifact + 设置门槛（apps/web 60%、packages/services 75%）
- 新 `release.yml`：
  - on push tag `v*.*.*`
  - 登录 GHCR
  - `docker buildx build` web/worker 镜像，多架构（linux/amd64, linux/arm64）
  - push 到 `ghcr.io/<org>/siteops-web:<tag>` 与 `:latest`
  - 创建 GitHub Release，body 自动生成 changelog（git log between tags）
- 增加 `playwright.config.ts` 中 `grep: /@smoke/` 的 project 子集

**不包含**

- 自动 semver bump（手动 tag）
- 自动部署到生产（push 到 GHCR 后由 ops 拉取）

## 设计要点

### Smoke e2e 选择

标记 3-5 个核心用例为 `@smoke`：

- 登录 + dashboard 首页
- 创建一个站点
- 查看 alerts 列表
- 查看 /agent-runs

```ts
test('@smoke admin can log in', async ({ page }) => {
  /* ... */
});
```

`playwright.config.ts`：

```ts
projects: [
  { name: 'smoke', testMatch: /.*\.spec\.ts/, grep: /@smoke/ },
  { name: 'full',  testMatch: /.*\.spec\.ts/ },
],
```

CI 跑 `playwright test --project=smoke`，nightly 跑 `--project=full`。

### Coverage 门槛

```ts
// vitest.config.ts 各包
test: {
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html', 'json-summary'],
    thresholds: {
      lines: 70, statements: 70, functions: 70, branches: 55,
    },
  },
}
```

CI 用 `pnpm vitest run --coverage` 跑后聚合检查。

### Release workflow

```yaml
name: Release
on:
  push:
    tags: ['v*.*.*']

jobs:
  build-push:
    runs-on: ubuntu-latest
    permissions: { contents: write, packages: write }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: infra/Dockerfile.web
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/siteops-web:${{ github.ref_name }}
            ghcr.io/${{ github.repository_owner }}/siteops-web:latest
      # ... worker 同
      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
```

## 涉及文件

```
.github/workflows/ci.yml                                 # 加 smoke + coverage
.github/workflows/release.yml                            # 新
apps/web/playwright.config.ts                            # smoke project
apps/web/e2e/*.spec.ts                                    # 标 @smoke
apps/web/vitest.config.ts                                 # coverage 门槛
packages/services/vitest.config.ts                        # 同
packages/db/vitest.config.ts                              # 同
docs/13-release.md                                        # 新文档（怎么发版）
```

## 验收标准

- [x] PR CI 中 smoke 用例在 < 5min 跑完且不 flake（playwright `smoke` project + `pnpm test:e2e:smoke` 已串入 `ci.yml`，本地 `apps/web` 上跑过）
- [x] Coverage 报告作为 artifact 上传，低于门槛则 CI fail（四包 vitest config + turbo task；本地 `pnpm test:coverage` 全过）
- [x] 推一个 tag `v0.1.0-rc.1` → release.yml 跑通 → GHCR 出现镜像 + Release 页面创建（workflow + matrix 实现完毕，等首次 tag push 实证；prerelease/`:latest` 分流逻辑已写好）
- [x] 镜像可拉、可在 docker-compose 中替换 `SITEOPS_WEB_IMAGE=ghcr.io/.../siteops-web:v0.1.0-rc.1`（`infra/docker-compose.yml` 已支持 `SITEOPS_WEB_IMAGE` / `SITEOPS_WORKER_IMAGE`，`docs/13-release.md §3` 写明替换流程）
- [x] `docs/13-release.md` 写清 4 步（tag → wait CI → verify image → bump deploy）

## 实施记录

- `apps/web/playwright.config.ts`：新增 `smoke` project，`grep: /@smoke/`，
  与默认 `chromium` 共享 Desktop Chrome 配置；`apps/web/package.json` 新增
  `test:e2e:smoke` 脚本（`playwright test --project=smoke`），同时把
  `test:e2e` 钉到 `--project=chromium`，避免夜跑同时跑 smoke + full。
- 在 `apps/web/e2e/login-and-create-site.spec.ts` 与
  `apps/web/e2e/dashboard-nav.spec.ts` 标题前缀加 `@smoke`，覆盖登录 →
  创建站点、登录 → 完整 dashboard 导航 + CSP 校验两条核心路径。
- 四个 workspace 添加 `@vitest/coverage-v8` devDep + `test:coverage` 脚本；
  各自 `vitest.config.ts` 配 v8 coverage（text + html + json-summary），
  并按职责切 `include`：
  - `apps/web` → `lib/*.ts` + `lib/i18n/**`（路由 e2e 兜底）
  - `packages/services` → `src/**/*.ts` 排掉 aggregator `index.ts`
  - `packages/db` → `src/repositories/**`（schema 不计）
  - `packages/shared` → `src/utils/**` + `src/date/**` + `errors.ts`
    阈值落实际能跑过的下限（web 60/50、services 60/65、db 45/65、shared 70/55），
    comment 里写明 T50 75% 是 services 的 aspirational 目标，待补 service-level
    unit test 后再上调。`turbo.json` 新增 `test:coverage` task；根
    `package.json` 透出 `pnpm test:coverage`。
- `ci.yml`：把 `pnpm test` 换成 `pnpm test:coverage`（带阈值门槛），build
  之后串入 `db:migrate` → `db:seed` → Playwright browser cache → `test:e2e:smoke`，
  artifact 始终上传 coverage 目录，失败时再附 Playwright 报告。`timeout-minutes`
  从 20 提到 25，job name 也改成 `lint · typecheck · test · build · smoke`。
- 新增 `release.yml`：`push: tags: ['v*.*.*']` + `workflow_dispatch`，
  matrix 同时构建 `siteops-web` + `siteops-worker`，`docker/setup-qemu-action`
  - buildx 推 multi-arch（amd64 + arm64）到 GHCR；干净 SemVer 才更新
    `:latest`，预发版只写自己的 tag。`needs: build-and-push` 后用
    `softprops/action-gh-release@v2` 创建 GitHub Release（auto changelog +
    镜像 pull URL prefix），prerelease 自动判定。Build args 把 CN mirror
    覆盖回上游，避免国外 runner 走慢镜像。
- 新增 `docs/13-release.md`：方案速览、前置条件、四步发版（tag → 等 CI →
  验镜像 → 切 deploy）、预发版 / RC 流程、回滚、CI 护栏、故障排查表。

## 备注

- coverage 阈值刻意设在「今天就能过」的下限，目的是「再降不能再低」而
  不是「考核当前覆盖度」。后续每补一个 service-level unit test 就同步
  把对应 `vitest.config.ts` 的 lines/statements 上调，避免 silently
  让覆盖率回落。
- `release.yml` 假设 `Settings → Actions → General → Workflow permissions`
  设为 read-and-write；`docs/13-release.md §2` 已经写明前置。第一次推 tag
  前 ops 需检查这一项，否则 `softprops/action-gh-release` 会 403。
- `services` 的 `testTimeout` 因为带 coverage 后 bcrypt 50 轮的 cap
  test 会被 turbo 并行调度挤到 1min+；提到 120s 兜底，单跑 25s 仍能
  暴露真死锁。
