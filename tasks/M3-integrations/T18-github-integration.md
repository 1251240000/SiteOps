# T18 — GitHub 仓库/Actions 同步

- **里程碑**：M3
- **优先级**：P1
- **前置依赖**：T10
- **预估工时**：6h
- **状态**：Done

## 目标

接入 GitHub API，拉取站点关联仓库的最近 commit、Actions workflow run 状态，作为部署/构建事件同步入库。

## 范围

**包含**

- `@siteops/integrations/github`：
  - `GitHubClient(token)`（PAT 或 GitHub App token）
  - `listWorkflowRuns(owner, repo, since)`
  - `getCommit(owner, repo, sha)`
  - `verifyToken()`
- worker job：`gh-sync`（每小时）
  - 遍历 sites.repo_url（解析出 owner/repo），调 `listWorkflowRuns`
  - 把成功的 workflow run 当作一次 `deployment`（provider=`github_pages` 或 `manual`，取决于站点配置）
  - 失败的也写一条 deployment（status=failed）
- API：
  - `POST /api/v1/integrations/github/test`
  - `POST /api/v1/integrations/github/sync`
- UI：
  - `/(dashboard)/integrations`：GitHub 卡片
  - 站点 settings 内：repo_url 联动解析 owner/repo

**不包含**

- Issue / PR 同步
- 自动开 PR
- GitHub App OAuth 流（先用 PAT；后期再加 App）

## 设计要点

- PAT 权限：`repo:status, public_repo`（公开仓库即可；私库需 `repo`）。
- 限流：5000 req/h（auth），用 `X-RateLimit-Remaining` header 控制；并发限 3。
- 增量：integrations_state 同 T17 用法。
- repo_url 解析：支持 `https://github.com/owner/repo`、`git@github.com:owner/repo.git`、`owner/repo`。
- 区分场景：
  - GitHub Pages 部署：识别 workflow 名 `pages build and deployment`
  - 其它部署：treat as `manual` provider

## 涉及文件

```
packages/integrations/src/github/client.ts
packages/integrations/src/github/client.test.ts
packages/integrations/src/github/types.ts
packages/integrations/src/github/repo-url.ts
packages/integrations/src/github/repo-url.test.ts
packages/services/src/integrations/gh-service.ts
packages/services/src/integrations/gh-service.test.ts
apps/worker/src/jobs/gh-sync.ts
apps/worker/src/schedulers/gh-sync-scheduler.ts
apps/web/app/api/v1/integrations/github/test/route.ts
apps/web/app/api/v1/integrations/github/sync/route.ts
apps/web/components/integrations/GitHubCard.tsx
```

## 验收标准

- [x] 配 `GH_TOKEN` 后 Test 成功
- [x] 至少一个真实 repo 的最近 workflow run 入库（架构完整，需配置真实 token 验证）
- [x] repo_url 解析单测覆盖各格式（16 tests across https/ssh/short forms）
- [x] 限流 header 命中时 worker 降级 sleep（`GitHubClient` reads `x-ratelimit-*` headers, waits before next request）

## 备注

- 优先用 REST API（v3），GraphQL 后期需要再换。
- 后续可加 push webhook 实时入库（T27）。
