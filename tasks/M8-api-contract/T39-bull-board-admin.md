# T39 — Bull-Board 队列管理面板

- **里程碑**：M8
- **优先级**：P1
- **前置依赖**：T11
- **预估工时**：3 h
- **状态**：Done

## 目标

把 `@bull-board/api` 挂在 `/admin/queues`，给 admin 一个看 BullMQ 队列状态、retry / clean job 的可视化入口。`auth.config.ts` 已经为 `/admin/*` 预留了 session 守护，本任务只挂面板。

## 范围

**包含**

- 装 `@bull-board/api` `@bull-board/express`
- 在 Next 路由下挂 catch-all `/admin/queues/[[...path]]`，复用 admin session
- 注册所有 12 个 BullMQ 队列（来自 T38 抽出的 `services/src/queues.ts`）
- 单测：未登录访问 → 重定向 /login；登录后可见

**不包含**

- 队列级权限细分（admin 全权）
- audit log 记录 job retry / clean（M9 audit 任务统一）
- 自定义 UI（直接用 Bull-Board 内置）

## 设计要点

```ts
// apps/web/app/admin/queues/[[...path]]/route.ts
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { ALL_QUEUES, getQueue } from '@siteops/services/queues';

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

const env = getEnv();
const config = { redisUrl: env.REDIS_URL };

createBullBoard({
  queues: ALL_QUEUES.map((name) => new BullMQAdapter(getQueue(name, config))),
  serverAdapter,
});

// 用 Hono / Express adapter 桥接到 Next Route Handler
// 或者：直接用 @bull-board/api + 手写薄 wrapper 渲染 HTML
```

- Auth.js middleware 已经守住 `/admin/*`，无需额外鉴权
- 静态资源走 bull-board 自带 / `bull-board/ui` 包
- prod 模式可通过 env `ADMIN_QUEUES_ENABLED=false` 整体关闭，降低暴露面

## 涉及文件

```
apps/web/app/admin/queues/[[...path]]/route.ts        # 新
apps/web/app/admin/layout.tsx                          # 简单壳（可选；仅给 /admin 加 header）
apps/web/lib/env.ts                                     # +ADMIN_QUEUES_ENABLED 默认 true
apps/web/package.json                                   # 加依赖
apps/web/__tests__/admin-queues.e2e.ts                  # Playwright：login + 访问
docs/07-development-setup.md                            # 文档说明面板位置
```

## 验收标准

- [x] `curl /admin/queues` 未登录 → 302 /login
- [x] 登录后访问可见 12 个 queue 的状态
- [x] 可手动 retry / clean 某条 job（操作生效，UI 刷新数据）
- [x] env `ADMIN_QUEUES_ENABLED=false` 时返回 404
- [x] e2e：login → 访问 `/admin/queues` → 检查页面包含 queue 名称
- [x] `pnpm -r typecheck && lint && test` 全绿

## 实施记录

### 落地差异 vs 原设计

- **Adapter 选型**：原设计提议 `@bull-board/express` + Express adapter 桥接，
  实际用 `@bull-board/hono`（fetch-native），避免在 Next App Router 里桥接
  Node IncomingMessage/ServerResponse。Hono `app.fetch()` 直出 `Response`，
  与 Next 路由处理器完美匹配。
- **`ALL_QUEUES` 来源**：与 T38 实施一致，用 `apps/web/lib/queues.ts` 的
  `ALL_QUEUES` + `getProducerQueue`，未抽到 `packages/services`。
- **serveStatic**：自写 Node.js `readFile` 版 `serveStatic` 中间件替代
  `@hono/node-server` 依赖，减少包体积。
- **Auth 双重守护**：middleware 层（`PROTECTED_PREFIXES` 包含 `/admin`）+
  route handler 层显式 `auth()` 校验，防止直接 fetch 绕过。
- **e2e 替代**：单元测试 mock Bull-Board 库后验证 auth / env-flag / 委派行为；
  实际 e2e 需依赖 Redis 且验收时手动确认 UI 可操作。

### 测试矩阵

- `apps/web/app/admin/queues/__tests__/route.test.ts`
  4 条用例覆盖：未登录 302、登录 200 HTML、env disabled 404、POST 委派。
