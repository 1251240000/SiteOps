# 05 · 编码规范

## 1. 通用原则

1. **类型先行**：先想清楚类型/契约，再写实现。Zod schema + Drizzle schema 是真理来源。
2. **小函数**：单文件 ≤ 300 行，单函数 ≤ 50 行。超出说明设计有问题。
3. **不写注释解释 What，注释只写 Why**。
4. **错误显式**：不吞异常，不裸 `catch (e) {}`；要么向上抛、要么写日志并降级。
5. **每个外部 IO 都要超时**：fetch/DB/redis 默认设 timeout，不允许悬挂。
6. **日志带 requestId / jobId / siteId**。
7. **不留 `console.log`**，统一用 `logger.info / warn / error`。
8. **不写魔法数字**，常量入 `packages/shared/constants.ts` 或就地命名。

## 2. TypeScript

- `tsconfig` 强制：`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`。
- 不用 `any`。万不得已用 `unknown` + 类型守卫。
- 类型导入用 `import type { ... }`。
- 优先 `type` 而非 `interface`，除非要做声明合并。
- 命名：
  - 类型/接口：`PascalCase`，例 `SiteSummary`。
  - 变量/函数：`camelCase`。
  - 常量：`UPPER_SNAKE_CASE`。
  - 文件：`kebab-case.ts`（React 组件文件 `PascalCase.tsx`）。
- 禁止默认导出，除非框架强制（如 Next.js page）。

## 3. React / Next.js

- App Router，**默认 RSC**；客户端组件文件首行 `"use client"`。
- 服务端能查的数据，绝不放到客户端再 fetch；必要时用 Server Action（仅突变）。
- 客户端缓存统一 TanStack Query；不要用 `useEffect` + `fetch` 写数据请求。
- 表单：react-hook-form + Zod resolver，不裸 `useState`。
- `key` 用稳定 id，不用 index。
- 组件分层：
  - `app/(dashboard)/sites/page.tsx` — 路由级（页面）
  - `components/sites/SiteList.tsx` — 业务组件
  - `components/ui/Button.tsx` — shadcn/ui 通用组件
- 任何"列表 + 详情"用 URL 状态（query string），不要全塞 React state。

## 4. 后端（Route Handlers）

- 文件 `app/api/v1/sites/route.ts` 仅做：
  1. 解析请求、Zod 校验
  2. 调 `services/siteService`
  3. 包成标准响应
- 不在 Route Handler 里写 SQL、不在 Route Handler 里 try/catch 业务逻辑。
- 统一用 `withApi(handler)` 包装：注入 logger、requestId、错误兜底。

```ts
// 伪代码示例
export const POST = withApi(async (req, ctx) => {
  const body = createSiteSchema.parse(await req.json());
  const site = await ctx.services.sites.create(body, ctx.user);
  return ctx.ok(site, { status: 201 });
});
```

## 5. 数据访问

- 所有查询走 `packages/db/repositories/*`。
- Repository 函数签名只接受简单值或 Drizzle 查询条件，不接受 HTTP 对象。
- 事务：用 `db.transaction(async (tx) => { ... })`，不在 Service 之外的层开事务。
- 不允许在 React Server Component 里直接 `import { db }`；必须经过 service 层（避免泄漏 schema 类型给 UI）。

## 6. 队列与 Worker

- 每个 job processor 一个文件：`apps/worker/src/jobs/<name>.ts`。
- Job 必须 **幂等**。
- 默认 attempts=3，退避 `exponential(2000)`。
- 失败时把上下文写入 `jobs_log`。
- Job payload 必须用 Zod schema 校验（Worker 入口处）。

## 7. 错误处理

- 自定义错误类：`AppError extends Error { code, status, details }`。
- Service 层抛 `AppError`，由 Route Handler 的 `withApi` 转标准 JSON。
- 上游错误（外部 API）包成 `UpstreamError`，保留原始 `cause`。

## 8. 安全

- **绝不**把秘密写进前端 bundle；含 token 的环境变量不加 `NEXT_PUBLIC_` 前缀。
- 所有外发 URL 校验为 http/https。
- SSRF 防护：站点 uptime 检查仅允许 `https?://` 且禁止内网段（10/8、172.16/12、192.168/16、127/8）。
- SQL 全部参数化（Drizzle 默认安全）。
- 用户上传：MVP 不接受任意文件上传；需要时只允许图片到对象存储。
- bcrypt cost 12；API key 校验必须用 constant-time compare。

## 9. 日志

```
logger.info({ siteId, durationMs }, "uptime check ok");
logger.warn({ siteId, statusCode }, "uptime check non-2xx");
logger.error({ err, siteId }, "uptime check failed");
```

- 第一个参数是 context object，第二个是 message。
- 严禁把整个 request body 写日志（含密码、token）。

## 10. 测试

- 单元测试与被测文件同目录：`siteService.ts` + `siteService.test.ts`。
- 每个 service 公共方法至少 1 个 happy + 1 个 error case。
- E2E 关键流：登录 → 创建站点 → 看到列表 → 触发审计 → 看到 finding。
- 测试必须独立：不依赖运行顺序、不依赖外网（外部 API 走 mock）。

## 11. 提交与变更

- Conventional Commits：`feat: ...`, `fix: ...`, `chore: ...`, `refactor: ...`, `docs: ...`, `test: ...`, `build: ...`, `ci: ...`。
- 一个 PR 解决一个任务（或子任务）；不要混合 refactor + feature。
- PR 描述模板：
  ```
  ## 关联任务
  T0X — 标题
  ## 改动
  - …
  ## 测试
  - …
  ## 风险/注意
  - …
  ```

## 12. 工具

- ESLint flat config：`@typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-import`, `eslint-config-prettier`。
- Prettier：默认 + `printWidth: 100`, `singleQuote: true`, `trailingComma: "all"`。
- husky + lint-staged：提交前跑 `eslint --fix` + `prettier --write` + `tsc --noEmit`（仅改动文件）。
- commitlint：`@commitlint/config-conventional`。
- CI：lint + typecheck + test + build 必须全绿才能 merge。

## 13. 目录命名

- App Router 路由组用括号：`(dashboard)`、`(public)`。
- 测试文件 `.test.ts(x)`；mock 数据放 `__fixtures__/`。
- 任何"自己以为不会复用"的逻辑都先放在最近的业务模块下，**不要预先抽 utils**；至少出现 2 次再上抽。
