# T04 — `@siteops/shared` 与 `@siteops/services` 初始化

- **里程碑**：M0
- **优先级**：P0
- **前置依赖**：T01, T03
- **预估工时**：3h
- **状态**：Done

## 目标

搭好两个关键共享层：`shared`（纯类型/Zod/常量/工具）和 `services`（业务逻辑入口），并把通用错误类、logger、env 解析、API 响应工具准备好。

## 范围

**包含**

- `@siteops/shared`：
  - 通用 Zod schemas（分页、ID、时间范围、cursor）
  - 常量枚举（站点类型、状态、审计类型、严重级别、告警通道类型）
  - 工具函数：`hashPassword`、`comparePassword`、`generateApiKey`、`hashApiKey`
  - `AppError` / `UpstreamError` / `ValidationError`
- `@siteops/services`：
  - `Container` 概念（DI 容器，简单版即可）—— 持有 db + logger + queues 引用
  - 通用 `Result` 类型 / `tryCatch` 包装
  - 各业务子目录骨架（仅 index.ts，留待 T08+ 填实现）
- 通用 logger（pino）封装：`createLogger(name, bindings)`
- 通用 env 解析（Zod）：单独导出，避免在每个 app 重写

**不包含**

- 实际业务方法（在对应任务里）
- HTTP 客户端封装（在 `@siteops/integrations`）

## 设计要点

- `shared` 不依赖 `db`、不依赖 React、不依赖 Next.js，可在浏览器和 Node 都跑。
- `services` 依赖 `shared` + `db`；不依赖 `apps/*`。
- 不引入 IoC 框架（如 InversifyJS），用最简手写 container：
  ```ts
  export type Container = {
    db: DB;
    logger: Logger;
    queues: Queues;
  };
  ```
- API key：32 字节随机，base64url 编码；首 8 位作 prefix 存明文，全部值 bcrypt(cost=12) 哈希入库。
- env 解析：用 Zod，缺失或错误时抛 `Invalid env: <details>` 直接中断启动。

## 涉及文件

```
packages/shared/src/index.ts
packages/shared/src/errors.ts                # AppError / UpstreamError / ValidationError
packages/shared/src/schemas/pagination.ts
packages/shared/src/schemas/common.ts        # idSchema, urlSchema, isoDateSchema
packages/shared/src/constants/site.ts        # SITE_TYPES, SITE_STATUS
packages/shared/src/constants/alert.ts
packages/shared/src/constants/audit.ts
packages/shared/src/utils/password.ts
packages/shared/src/utils/api-key.ts
packages/shared/src/utils/result.ts
packages/shared/src/utils/logger.ts          # 基于 pino
packages/shared/src/utils/env.ts             # parseEnv(schema, source)

packages/services/src/index.ts
packages/services/src/container.ts
packages/services/src/sites/index.ts          # 占位
packages/services/src/domains/index.ts
packages/services/src/deployments/index.ts
packages/services/src/audits/index.ts
packages/services/src/alerts/index.ts
packages/services/src/metrics/index.ts
packages/services/src/errors/index.ts
```

## 验收标准

- [x] `pnpm -F @siteops/shared test` 通过：password 与 api-key 工具有单测
- [x] `pnpm -F @siteops/services build` 通过
- [x] `apps/web` 与 `apps/worker` 都能 `import { AppError } from '@siteops/shared'` 编译通过
- [x] env 解析 demo：故意删一个变量，启动报清晰错误

## 备注

- API key 工具的随机源用 `crypto.randomBytes`，禁止 `Math.random`。
- password 哈希用 `bcryptjs`（纯 JS，不需要 native binding，便于 Alpine 容器）。

### 落地说明（2026-05-13 完成）

- **`@siteops/shared` 依赖**：`zod@3.25.76`、`bcryptjs@3.0.3`（与 db 同版，便于 hoist 复用）、`pino@9.5.0`。零运行时 native 依赖，浏览器/Node 双向可用。
- **目录拆分**：`errors.ts`（`AppError` + `ValidationError` + `UpstreamError` + `isAppError`）、`schemas/{common,pagination}.ts`、`constants/{site,audit,alert}.ts`、`utils/{password,api-key,result,logger,env}.ts`。
- **subpath exports** 暴露五个入口：`.` / `./errors` / `./constants` / `./schemas` / `./utils`，避免上层不必要的桶导入。
- **API key 方案**：32 字节 `node:crypto.randomBytes` → base64url（42–44 字符），首 8 字符作为 `key_prefix` 明文入库（与 T03 `api_keys` schema 一致），整串 `bcrypt(cost=12)` → `key_hash`。`compareApiKey` 走 bcrypt 内置常量时间比较，对畸形 hash 静默返回 false 不抛。
- **password**：与 api-key 共享 `BCRYPT_COST=12`；`comparePassword` 同样对畸形 hash 静默 false。
- **`parseEnv`**：必传 `source` 入参（不默认 `process.env`），保证 shared 在浏览器 bundler 下也无副作用；失败抛 `AppError(code='invalid_env', status=500)`，`details.issues` 是 `{path, message}` 数组。
- **logger**：`createLogger(opts?)` 基于 pino，默认 level 取 `process.env.LOG_LEVEL ?? 'info'`；`getRootLogger()` 提供 CLI/脚本用单例。`Logger` 类型导出。
- **`@siteops/services`**：手写 `Container = { db, logger, queues }` + `createContainer()`；`Queues` 暂为 `Record<string, unknown>` 占位，T11 BullMQ 落地后替换。业务模块 `sites/domains/deployments/audits/alerts/metrics/` 全部留空 `index.ts` 占位，barrel 用命名空间导出避免后续 T08+ 改动入口签名时影响下游。`errors/index.ts` 直接 re-export `@siteops/shared` 三个错误类。
- **常量真理源**：`@siteops/shared/constants/*` 是服务/UI 层的规范来源；db schema 文件保留自身 const tuple（CHECK constraint 需要字面量），由新增的 `packages/db/src/schema/__tests__/constants-drift.test.ts` 通过 `it.each` 在 CI 中防漂移（13 条枚举对比，顺序+集合双重校验）。
- **测试**：`@siteops/shared` 单测 15 个用例（password 5 / api-key 7 / env 3），首跑 ~3.5s，使用 vitest@3.2.4 + `tsconfig.build.json` 排除测试源。
- **构建分离**：`tsconfig.json` 仅 typecheck（`noEmit`，包含测试），`tsconfig.build.json` 编译产物排除 `__tests__/` 与 `*.test.ts`，与 `@siteops/db` 风格保持一致。
- **smoke 引用**：`apps/web/src/index.ts` 与 `apps/worker/src/index.ts` 各加一行 `import { AppError } from '@siteops/shared'` 作为下游解析的编译期证明，T07/T11 真实代码上线时删除。
- **未涉及**（按范围）：业务方法实现（在对应任务）、HTTP 客户端封装（`@siteops/integrations` 在 M3 任务里）、`response`/`withApi` 包装器（属 T07 web 应用层）。
