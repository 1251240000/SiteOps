# T01 — Monorepo 骨架与工具链

- **里程碑**：M0
- **优先级**：P0
- **前置依赖**：—
- **预估工时**：4h
- **状态**：Done

## 目标

建立 pnpm + Turborepo 单仓多包结构，配齐 TS / ESLint / Prettier / commitlint / husky / lint-staged，使后续任务可以独立增量开发。

## 范围

**包含**

- pnpm workspace
- Turborepo (`turbo.json`)
- 根 `tsconfig.base.json`
- 共享 ESLint 与 Prettier 配置
- Git hooks（husky + lint-staged + commitlint）
- 空 `apps/web`、`apps/worker` 占位（仅 `package.json` + `tsconfig.json`，能 `pnpm build` 不报错）
- 空 `packages/db` / `services` / `integrations` / `shared` 占位
- `.env.example`、`.gitignore`、`.editorconfig`、`.nvmrc`、根 `README.md` 已存在不动

**不包含**

- 任何业务代码
- Next.js 实际页面（T07）
- Worker 实际逻辑（T11）
- DB schema（T03）
- CI 配置（T05）

## 设计要点

- pnpm workspace globs：`apps/*`、`packages/*`
- Turborepo pipeline：`build`、`lint`、`typecheck`、`test`、`dev`（dev 不缓存、persistent）
- TS 路径别名：通过 `tsconfig.base.json` 的 `paths` 让所有包能 `@siteops/*` 引用；运行时由 `tsup` 或 `tsc --build` 编译产出。
- ESLint 9 flat config，导出在 `packages/config-eslint`。
- Prettier 配置在根 `prettier.config.mjs`。
- commitlint 用 `@commitlint/config-conventional`。
- husky v9（新版 init 命令）。
- 占位包必须 `"private": true`，避免误发 npm。

## 涉及文件

```
package.json
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
prettier.config.mjs
commitlint.config.cjs
.husky/pre-commit
.husky/commit-msg
.editorconfig
.nvmrc
.gitignore
.env.example
packages/config-eslint/package.json
packages/config-eslint/index.js
packages/config-typescript/package.json
packages/config-typescript/base.json
packages/config-typescript/nextjs.json
packages/config-typescript/node.json
apps/web/package.json
apps/web/tsconfig.json
apps/worker/package.json
apps/worker/tsconfig.json
packages/db/package.json
packages/db/tsconfig.json
packages/services/package.json
packages/services/tsconfig.json
packages/integrations/package.json
packages/integrations/tsconfig.json
packages/shared/package.json
packages/shared/tsconfig.json
packages/shared/src/index.ts          # 导出占位 const VERSION = '0.0.0'
```

## 验收标准

- [x] `pnpm install` 成功且无 peer-dep 警告
- [x] `pnpm -w lint`、`pnpm -w typecheck`、`pnpm -w build`、`pnpm -w test` 全部成功（即使空）
- [x] 提交一条 `feat: scaffold monorepo` 能通过 commitlint；提交一条 `bad message` 会被拒
- [x] husky pre-commit 钩子在改任一文件后执行 eslint + prettier
- [x] `node -v` 与 `.nvmrc` 一致（20 LTS）

## 备注

> 在 T01 完成前不要并行写其它任务，避免与基线冲突。

### 落地说明（2026-05-12 完成）

- `pnpm` 由 corepack 启用 9.12.3；`husky` v9 自动管理 `.husky/_` 钩子代理目录。
- 占位包统一使用：`tsc -p tsconfig.json` 做 build/typecheck，`eslint .` 做 lint，`test` 暂为 `echo` 直到 T03/T08 引入首批 Vitest。
- 共享 ESLint 配置以包形式发布：`@siteops/eslint-config`（导出 ESLint 9 flat config）；共享 tsconfig 以 `@siteops/tsconfig` 提供 `base.json` / `node.json` / `nextjs.json` 三个 preset。
- 根 `tsconfig.base.json` 仅承载跨包 `paths` 别名，运行时仍以各包 `dist/` 为准（`workspace:*` 链接保证类型解析）。
- ⚠ 当前开发机 `node -v=v22.22.0`，`.nvmrc` 仍按规范写 `20`；CI（T05）会强制按 `.nvmrc` 安装 Node 20。
