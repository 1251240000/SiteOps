# 06 · Git 工作流

## 1. 仓库与分支

- 单仓库 monorepo。
- 主分支：`main`，永远可部署。
- 任务分支：`<type>/T<NN>-<short-slug>`，例：
  - `feat/T08-site-registry`
  - `fix/T11-uptime-timeout`
  - `chore/T01-monorepo-setup`
- 不使用长期 `develop`。MVP 阶段也不开 release 分支。

## 2. 提交信息（Conventional Commits）

格式：`<type>(<scope>)?: <subject>`

| type       | 用途                 |
| ---------- | -------------------- |
| `feat`     | 新功能               |
| `fix`      | 修 bug               |
| `refactor` | 不改外部行为的重构   |
| `perf`     | 性能优化             |
| `test`     | 测试相关             |
| `docs`     | 文档                 |
| `chore`    | 构建/工具/依赖       |
| `build`    | 构建系统、Dockerfile |
| `ci`       | CI 配置              |
| `revert`   | 回滚                 |

scope 用任务编号或模块：`feat(sites): add health score` / `feat(T08): scaffold site CRUD`。

主题行 ≤ 72 字符，命令式英文/中文皆可，但全仓统一一种（建议英文，便于工具识别）。

body 用于解释 Why。breaking change 用 `!`：

```
feat(api)!: switch /sites pagination to cursor

BREAKING CHANGE: ?page=N no longer supported.
```

## 3. PR 流程

1. 从 `main` 切任务分支。
2. 本地完成任务文档中的"验收标准"。
3. 自查：`pnpm lint && pnpm typecheck && pnpm test && pnpm build`。
4. 推送，开 PR，标题用 `[T0X] 任务标题`。
5. CI 必须全绿。
6. self-review（单人项目也走一遍 Files Changed）。
7. squash merge 到 `main`，删除分支。

## 4. PR 模板

```markdown
## 关联任务

T0X — 任务标题

## 改动概要

-

## 实现要点

-

## 测试

- [ ] 单元测试已添加/更新
- [ ] 本地 E2E 已通过
- [ ] 手动验证步骤：...

## 风险与回滚

- 数据库迁移：是 / 否
- 影响接口：...
- 回滚方式：...

## 截图（若 UI 变更）
```

## 5. 数据库迁移

- 使用 `drizzle-kit generate`，迁移 SQL 入仓 `packages/db/migrations/`。
- **每个改 schema 的 PR**：
  - 包含 schema 改动 + 自动生成的 SQL 迁移
  - 不允许手改已合并的迁移文件，要修就新加一份
- 迁移命名：`NNNN_<short_description>.sql`（drizzle-kit 默认即可）。

## 6. 版本与发布

- 使用 SemVer：`MAJOR.MINOR.PATCH`。
- MVP 阶段保持 `0.x.y`。
- 每次 merge 到 `main` 自动生成 `0.0.<n>` tag（可选）。
- 正式 0.1.0：完成 M0+M1。
- 0.2.0：完成 M2。

## 7. .gitignore 约定

至少包含：

```
node_modules/
.pnpm-store/
.next/
dist/
build/
coverage/
.turbo/
.env
.env.*
!.env.example
*.log
.DS_Store
```

## 8. 大文件 / 二进制

- 仓库内严禁 > 5MB 二进制。
- Lighthouse 报告等大产物存到本地 `data/` 目录（gitignore）或对象存储；DB 只存路径。

## 9. 钩子

- `pre-commit`：lint-staged（eslint + prettier + tsc on changed files）。
- `commit-msg`：commitlint。
- `pre-push`：可选 `pnpm test --run --changed`。

## 10. 紧急修复

线上 bug：

1. 直接从 `main` 切 `fix/hotfix-<slug>`。
2. 最小化改动 + 测试。
3. 合并后立即部署。
4. 事后补任务 doc（不允许"我先改了再补"成为习惯）。
