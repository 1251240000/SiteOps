# T06 — Auth.js 单 admin 登录

- **里程碑**：M1
- **优先级**：P0
- **前置依赖**：T04
- **预估工时**：5h
- **状态**：Done

## 目标

为 Dashboard 接入 Auth.js v5 Credentials Provider，单 admin 登录；同时为外部 Agent 提供 API key 中间件。

## 范围

**包含**

- Auth.js v5 配置（Credentials + session 策略 = jwt）
- 登录页 `/login`
- 中间件保护 `/(dashboard)` 路由组
- `/api/v1/auth/me`
- API key 中间件：`withApiKey(handler, requiredScope?)`
- `withApi(handler)`：统一注入 logger/requestId/user 或 apiKey、统一错误兜底

**不包含**

- 注册功能（admin 由 seed 创建）
- OAuth provider
- 多用户 RBAC

## 设计要点

- session 用 JWT（无需 session 表），有效期 7 天。
- 登录限速：同 IP 5 次/分钟（基于 Redis）。
- API key：从 `Authorization: Bearer <key>` 读取；按 prefix 查 `api_keys`，bcrypt 比对全值；记录 `last_used_at`。
- API key 校验失败统一 401，不暴露原因。
- scope 检查：`requiredScope` 为字符串数组，全集匹配。
- 错误转 JSON：`AppError → { error: { code, message, details, requestId } }`。

## 涉及文件

```
apps/web/lib/auth.ts                       # Auth.js config (NextAuth(authOptions))
apps/web/app/api/auth/[...nextauth]/route.ts
apps/web/app/(auth)/login/page.tsx
apps/web/app/(auth)/layout.tsx
apps/web/middleware.ts                     # 保护 /(dashboard)
apps/web/lib/with-api.ts                   # withApi(handler) + withApiKey(handler, scopes)
apps/web/lib/request-id.ts
apps/web/app/api/v1/auth/me/route.ts
packages/services/src/auth/auth-service.ts # 仅密码校验、API key 校验
packages/services/src/auth/auth-service.test.ts
```

## 验收标准

- [x] 未登录访问 `/sites` 自动跳 `/login?callbackUrl=...`（实测 `curl /sites` → `307 Location: /login?callbackUrl=...`）
- [x] 用 seed 用户登录成功，session cookie 写入（POST `/api/auth/callback/credentials` → 302 + `authjs.session-token` Cookie）
- [x] `GET /api/v1/auth/me` 返回 admin 信息（带 session cookie 时返回 `{ data: { id, email, name } }` + 200）
- [x] 未带 API key 访 `/api/v1/sites` 返回 401（`{ error: { code: 'unauthorized', message: 'API key required', requestId } }`）
- [x] 错误响应 shape 符合 `docs/04-api-spec.md`（`{ error: { code, message, requestId, details? } }`，`x-request-id` 同步回写）
- [x] 单测：password 校验、API key 校验、scope 校验（`packages/services/src/auth/__tests__/auth-service.test.ts`：15 tests 全绿）

## 备注

- 密码错误响应延迟 200–500ms 随机抖动，缓解时序攻击。
- `AUTH_SECRET` 必须在 prod 模式启动时强制存在，否则 fail-fast。
- 登录限速：每 IP 每分钟 5 次（`LOGIN_RATE_LIMIT_PER_MIN` 可调），Redis `INCR + EXPIRE` 滑动窗口；Redis 不可达时 fail-open 并 warn。
- API key 中间件：从 `Authorization: Bearer <key>` 读取，按 `key_prefix` 索引取行 → bcrypt 比对全值 → 拒过期/吊销 → 异步 stamp `last_used_at`。scope `*` 视为全权限。
- 实现拆分：`lib/auth.config.ts`（Edge-safe，被 `middleware.ts` 引用，仅做 JWT 是否存在的 gating），`lib/auth.ts`（Node runtime，含 Credentials provider + DB / bcrypt / rate-limit）。
- `lib/with-api.ts` 提供 `withApi`（要求 session）与 `withApiKey(handler, { scopes })`（要求 Bearer + 可选 scopes）两个统一包装，统一注入 `requestId`、pino child logger，并把 `AppError` 翻译成 `docs/04-api-spec.md` 的错误体。
- `next.config.mjs` 启用 `output: 'standalone'`；`infra/Dockerfile.web` 已切换为复制 `.next/standalone` + `.next/static` 的 runtime，删除 `apps/web/server.placeholder.cjs`。
- `turbo.json` 显式声明 `build` / `test` 任务依赖的 env（`DATABASE_URL` / `REDIS_URL` / `AUTH_SECRET` / `AUTH_URL` / `LOGIN_RATE_LIMIT_PER_MIN`），避免 Turbo 2 严格模式下被剥离。
- `apps/web/tsconfig.json` 在 `nextjs.json` 基础上关掉 `declaration` / `composite`，规避 pnpm 软链 + `next-auth` re-export 触发的 TS2742 "inferred type not portable" 误报。
