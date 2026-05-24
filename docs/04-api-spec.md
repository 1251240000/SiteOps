# 04 · API 设计规范

## 1. 总则

- **风格**：REST + JSON。资源为名词复数，动作用 HTTP 方法。
- **路径前缀**：`/api/v1/`。版本永远显式。
- **认证**：
  - 浏览器：cookie session（Auth.js）
  - 程序：`Authorization: Bearer <api_key>`
- **内容类型**：`Content-Type: application/json; charset=utf-8`。
- **时间格式**：ISO 8601 with offset，例如 `2026-05-12T08:30:00.000Z`。
- **分页**：高频长表使用 keyset cursor 分页（`?cursor=<base64url>&limit=<n>`，limit 最大 100、默认 20）；其余资源仍是 `?page=N&limit=M` 的 offset 分页，并向后兼容。T36 已将 `agent_runs` / `webhook_events` / `errors` / `uptime_checks` 改造为 cursor —— 详见下方 §2 的 meta 规范与 §3 的 "Pagination" 列。
- **筛选**：query string，例如 `?site_type=tool&status=active`。
- **排序**：`?sort=-created_at` （`-` 为降序）。
- **校验**：所有入参用 Zod schema；失败返回 400 + 详细字段错误。
- **幂等**：所有 `POST` / `PUT` / `PATCH` 端点支持 `Idempotency-Key` header，重复请求会回放首次响应，详见 §9（M8 / T37 已实现）。

## 2. 标准响应

成功：

```json
{
  "data": { ... } | [ ... ],
  "meta": { ... }
}
```

`meta` 形态因端点而异：

- **Offset 分页**（绝大多数列表，向后兼容）：
  ```json
  {
    "page": 1,
    "limit": 50,
    "total": 123,
    "totalPages": 3,
    "cursor": { "next": "<base64url|null>" },
    "hasMore": true
  }
  ```
  即使是 offset 模式，T36 已迁移的高频端点也会一并返回 `cursor.next` 与 `hasMore`，方便客户端从 page 1 起切换到 cursor 模式继续翻页。
- **Cursor 分页**（T36 高频端点：`/agent-runs`、`/hooks`、`/errors`、`/sites/{id}/uptime?cursor=...`）：
  ```json
  {
    "limit": 50,
    "cursor": { "next": "<base64url|null>" },
    "hasMore": true
  }
  ```
  传入 `?cursor=<base64url>` 即进入 cursor 模式；`?page=N` 仍走 offset 模式。`cursor` 为 base64url 编码的 `{ id, ts }` 二元组，**对客户端不透明**。

错误：

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Invalid request body",
    "details": [{ "path": ["primary_url"], "message": "Invalid URL" }],
    "requestId": "req_01HXY..."
  }
}
```

错误码（部分）：

| code                   | HTTP | 说明                                                  |
| ---------------------- | ---- | ----------------------------------------------------- |
| `validation_failed`    | 400  | 入参校验失败                                          |
| `unauthorized`         | 401  | 未登录或 API key 无效                                 |
| `forbidden`            | 403  | 已认证但无权限                                        |
| `not_found`            | 404  | 资源不存在                                            |
| `conflict`             | 409  | 唯一约束冲突                                          |
| `idempotency_conflict` | 422  | `Idempotency-Key` 与首次请求的 body 不一致（详见 §9） |
| `rate_limited`         | 429  | 命中限流                                              |
| `upstream_failed`      | 502  | 外部 API 错误                                         |
| `internal_error`       | 500  | 未分类错误                                            |

## 3. 路由清单（MVP）

> 所有路由都在 `apps/web/app/api/v1/...` 下作为 Route Handlers 实现。

### 3.1 认证

| 方法 | 路径                  | 说明                                             |
| ---- | --------------------- | ------------------------------------------------ |
| POST | `/api/v1/auth/login`  | （Auth.js 内置的 callback 之外的便捷端点，可选） |
| POST | `/api/v1/auth/logout` |                                                  |
| GET  | `/api/v1/auth/me`     | 当前会话信息                                     |

### 3.2 站点

| 方法   | 路径                              | 说明                             |
| ------ | --------------------------------- | -------------------------------- |
| GET    | `/api/v1/sites`                   | 列表，支持过滤/排序/分页         |
| POST   | `/api/v1/sites`                   | 创建                             |
| GET    | `/api/v1/sites/{id}`              | 详情                             |
| PATCH  | `/api/v1/sites/{id}`              | 局部更新                         |
| DELETE | `/api/v1/sites/{id}`              | 归档（不真正删除）               |
| GET    | `/api/v1/sites/{id}/health`       | 健康汇总                         |
| POST   | `/api/v1/sites/{id}/audits`       | 触发一次审计（seo / lighthouse） |
| POST   | `/api/v1/sites/{id}/uptime-check` | 触发一次即时 uptime              |

### 3.3 域名

| 方法   | 路径                               | 说明         |
| ------ | ---------------------------------- | ------------ |
| GET    | `/api/v1/domains`                  | 列表         |
| POST   | `/api/v1/domains`                  | 新增         |
| PATCH  | `/api/v1/domains/{id}`             |              |
| DELETE | `/api/v1/domains/{id}`             |              |
| POST   | `/api/v1/domains/{id}/refresh-ssl` | 立刻探测 SSL |

### 3.4 部署

| 方法 | 路径                             | 说明                     |
| ---- | -------------------------------- | ------------------------ |
| GET  | `/api/v1/deployments`            | 全局部署历史             |
| POST | `/api/v1/deployments`            | 由 Agent/CI 上报一次部署 |
| GET  | `/api/v1/deployments/{id}`       |                          |
| GET  | `/api/v1/sites/{id}/deployments` | 单站部署列表             |

### 3.5 监控

| 方法 | 路径                           | 说明                    |
| ---- | ------------------------------ | ----------------------- |
| GET  | `/api/v1/sites/{id}/uptime`    | 时序数据                |
| GET  | `/api/v1/sites/{id}/audits`    | 审计运行列表            |
| GET  | `/api/v1/audits/{id}`          | 单次审计详情            |
| GET  | `/api/v1/audits/{id}/findings` | 该次审计的所有 findings |

### 3.6 错误

| 方法  | 路径                  | 说明                       |
| ----- | --------------------- | -------------------------- |
| POST  | `/api/v1/errors`      | 站点端 SDK 上报（API key） |
| GET   | `/api/v1/errors`      | 列表                       |
| PATCH | `/api/v1/errors/{id}` | 标记 resolved              |

### 3.7 告警

| 方法   | 路径                               | 说明         |
| ------ | ---------------------------------- | ------------ |
| GET    | `/api/v1/alert-rules`              |              |
| POST   | `/api/v1/alert-rules`              |              |
| PATCH  | `/api/v1/alert-rules/{id}`         |              |
| DELETE | `/api/v1/alert-rules/{id}`         |              |
| GET    | `/api/v1/alert-channels`           |              |
| POST   | `/api/v1/alert-channels`           |              |
| POST   | `/api/v1/alert-channels/{id}/test` | 发送测试消息 |
| GET    | `/api/v1/alerts`                   | 历史告警     |
| POST   | `/api/v1/alerts/{id}/ack`          | 人工确认     |

### 3.8 指标

| 方法 | 路径                                | 说明               |
| ---- | ----------------------------------- | ------------------ |
| GET  | `/api/v1/sites/{id}/metrics/daily`  | 单站每日指标       |
| GET  | `/api/v1/metrics/overview`          | 全局 KPI（首页用） |
| GET  | `/api/v1/sites/{id}/search-console` | GSC 数据           |
| GET  | `/api/v1/sites/{id}/adsense`        | AdSense 数据       |

### 3.9 集成（M3）

| 方法 | 路径                                   | 说明             |
| ---- | -------------------------------------- | ---------------- |
| POST | `/api/v1/integrations/cloudflare/test` | 验证 token       |
| POST | `/api/v1/integrations/github/test`     |                  |
| POST | `/api/v1/integrations/{provider}/sync` | 立即触发一次同步 |

### 3.10 系统

| 方法 | 路径                     | 说明                       |
| ---- | ------------------------ | -------------------------- |
| GET  | `/healthz`               | liveness（不在 v1 下）     |
| GET  | `/readyz`                | readiness（DB/Redis 连通） |
| GET  | `/api/v1/system/version` | 版本号                     |
| GET  | `/api/v1/system/jobs`    | 队列状态                   |

均仅接受 admin session（不接受 Bearer key）。

- `/system/version` 返回 `{ version, gitSha, nodeVersion, startedAt }`：
  `version` 取 `package.json#version`，`gitSha` 由发布流水线注入
  （`docker build --build-arg GIT_SHA=...`），`startedAt` 由
  `apps/web/instrumentation.ts` 在冷启动写入 `process.env.BOOTED_AT`。
- `/system/jobs` 返回每个 BullMQ 队列的 `waiting / active / delayed / completed / failed`
  计数；当某条队列连接异常时单独返回 `error` 字段、计数全为 0，**不**让整个响应失败。
  队列清单由 `apps/web/lib/queues.ts:ALL_QUEUES` 提供，必须与 `apps/worker/src/queues.ts:ALL_QUEUES` 同步。

## 4. Webhook 入口（站点端 → 平台）

| 路径                                        | 用途                       |
| ------------------------------------------- | -------------------------- |
| `POST /api/v1/hooks/cloudflare`             | CF Pages 部署事件回调      |
| `POST /api/v1/hooks/github`                 | GitHub Actions / push 事件 |
| `POST /api/v1/hooks/{provider}/replay/{id}` | admin 手动重放历史投递     |

签名校验必须开启（HMAC）。

### 4.1 签名格式

| Provider     | 签名头                | 算法        | 编码           |
| ------------ | --------------------- | ----------- | -------------- |
| `cloudflare` | `cf-webhook-auth`     | HMAC-SHA256 | hex            |
| `github`     | `x-hub-signature-256` | HMAC-SHA256 | `sha256=<hex>` |

校验在 service 层 (`webhookService.verifyAndIngest`) 用 `crypto.timingSafeEqual` 做长度归一比较；长度不同也走 fallback 避免侧信道。`Content-Type` 强制 `application/json`，其它（如 GitHub 旧的 `application/x-www-form-urlencoded`）一律 415。

### 4.2 响应矩阵

| 情形                                                    | 状态码 | 说明                                                                                                          |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| 未配置该 provider 的 secret                             | `503`  | `{ error: { code: 'webhook_not_configured' } }`                                                               |
| Content-Type 非 JSON                                    | `415`  | `unsupported_media_type`                                                                                      |
| 缺 `delivery_id` / `event_type` 或 payload 非 JSON 对象 | `400`  | `validation_failed`                                                                                           |
| 签名缺失 / 校验失败                                     | `401`  | 仍然写入 `webhook_events`（`signature_ok=false`）便于审计                                                     |
| 同源 IP 5 分钟内 > 50 次坏签名                          | `401`  | 退到 `rate_limited`，不再入库                                                                                 |
| 同一 `(provider, delivery_id)` 第二次投递               | `200`  | `{ data: { id, duplicate: true } }` — **不**重跑 dispatch                                                     |
| 全部通过                                                | `202`  | `{ data: { id, duplicate: false } }`；`meta.dispatch_failed=true` 表示下游 service 抛错（webhook 通道已 ack） |

`meta.dispatch_failed=true` 时 row 的 `error` 字段会保留下游错误，admin 可用 replay 路径修复。

### 4.3 dispatch 映射

| Provider | event_type                 | 行为                                                                                        |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| CF       | `deployment.started`       | `deploymentService.create({ provider:'cloudflare_pages', status:'building' })`              |
| CF       | `deployment.success`       | 同上 `status='success'`，附 `commitSha / branch / buildLogUrl`                              |
| CF       | `deployment.failure`       | `status='failed'`                                                                           |
| GH       | `workflow_run.completed`   | `conclusion=success → success`；否则 `failed`；Pages 工作流 → `github_pages`，否则 `manual` |
| GH       | `workflow_run.in_progress` | `status='building'`                                                                         |
| GH       | `push`                     | 仅入库 `webhook_events`，**不**创建 deployment                                              |
| GH       | `deployment_status`        | 转 `deploymentService.create`，state→status                                                 |
| GH       | `ping`                     | 仅返回 `accepted`；用于初次接入 GitHub 时的连接性测试                                       |

upsert 的幂等由 `(provider, provider_deployment_id)` 唯一索引保证（T10 已落地）；webhook 与 cron 即使竞争入库也只会汇成一行。

### 4.4 replay 语义

`POST /api/v1/hooks/{provider}/replay/{id}` 仅接受 admin session（不接受 API key）。

- 行为：从 `webhook_events` 读 row → 把 `payload` 重新喂回 dispatch path → 写新的 `processed_at` / `error`，并 `attempts += 1`
- **不重新校验签名**——payload 已落库，视为可信
- 不能 replay `signature_ok=false` 的 row（403 `forbidden`）
- path 里的 provider 必须等于 row 的 provider，否则 400 — 防 admin 手滑跨 provider 重放

## 5. 限流

- 浏览器 session：每 IP 60 req/min。
- API key：默认由 `API_KEY_RATE_LIMIT_PER_MIN`（环境变量，默认 600）控制；
  可以在 `api_keys.rate_limit_per_min` 列上为单个 key 设置正整数覆盖，
  `NULL` 则回落到环境默认。覆盖通过 `verifyApiKey()` 一并返回，**不**额外查 DB。
- 该字段可在 settings UI 的 API key 表格中通过 ✏️ 行内编辑或在创建对话框里指定。
  REST 入口：
  - `POST /api/v1/settings/api-keys`：可选 `rateLimitPerMin: number`。
  - `PATCH /api/v1/settings/api-keys/{id}`：`{ rateLimitPerMin: number | null }`。
    `null` 显式清除覆盖；body 必须包含至少一个可变字段。
- 实现：内存 + Redis token bucket（小流量直接 Redis）。

## 6. 版本演进

- 增字段、加可选参数：v1 内兼容。
- 改语义、删字段、改返回结构：开 `/api/v2/`。
- 弃用走 `Deprecation` + `Sunset` 响应头。

## 7. OpenAPI

> 状态：**已实现**（M8 / T35）。

- Spec 生成：`apps/web/lib/openapi/*` 用 `@asteasolutions/zod-to-openapi` 把 `packages/shared/src/schemas/*` 转成 OpenAPI 3.1 文档；每个 v1 路由在 `lib/openapi/routes/<noun>.ts` 里手工调用 `registry.registerPath(...)` 把 method / path / 安全要求 / 请求体 / 响应体绑定到 zod schema。
- 运行时入口：`GET /api/v1/openapi.json`（始终可用，60s cache）由 `app/api/v1/openapi.json/route.ts` 直接返回 `buildOpenApiDocument()`。
- 开发者文档页：`GET /api/v1/docs` 在非 production 环境返回 Swagger UI 页面（CDN 加载 `swagger-ui-dist`），生产环境返回 404。
- 凝固快照：`docs/openapi.json` 是 `buildOpenApiDocument()` 的固化产物，与代码同 PR 提交；通过 `pnpm --filter @siteops/web openapi:check`（在 CI 里跑）防止路由改动忘记同步 spec。
- 重生流程：
  1. 改路由或 schema。
  2. `pnpm --filter @siteops/web openapi:generate` 重写 `docs/openapi.json`。
  3. 一并提交。`openapi:check` 在 CI 跑通即合并。
- 命名 schema：所有 request / row schema 用 `.openapi('XxxInput' | 'XxxRow')` 注册成命名 component，方便客户端代码生成器（如 `openapi-typescript`、`orval`）按名引用；未命名的兜底是 `additionalProperties: true` 的对象，保持向前兼容。

## 8. 安全响应头

平台对所有出站响应注入一组基线安全头，分两层落地：

1. **Caddy（边缘）** — `infra/caddy/Caddyfile` 的 `siteops_upstream` snippet 给所有 upstream 路径加：
   - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`（仅 TLS 站点生效；HTTP 上浏览器自动忽略）
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   - `-Server`（移除 Caddy 版本指纹）
2. **Next.js middleware（应用）** — `apps/web/middleware.ts` 调用 `lib/security-headers.ts#applySecurityHeaders`，对 dashboard / `/login` 等 HTML 路由额外注入：
   - 上述 4 个非 HSTS 头（与 Caddy 重复，作为脱离 Caddy 部署 / `pnpm dev` 的兜底）
   - `Content-Security-Policy`（prod）或 `Content-Security-Policy-Report-Only`（dev/test），值见下文

### 8.1 CSP 策略

```text
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

- `'unsafe-inline'` 留作过渡：Next 15 仍会发布 inline bootstrap，Tailwind / `next-themes` 也会内联 style。下一步是 nonce-based CSP（layout 注入 per-request nonce），跟在 T33 之后。
- `frame-ancestors 'none'` 与 Caddy 的 `X-Frame-Options: DENY` 双重防点击劫持。
- API 路由（`/api/*`）不返回 CSP — 浏览器不执行 JSON 响应中的脚本，CSP 是噪声；同样 `/_next/static/*`、`/favicon.ico`、`/healthz` 都被 middleware matcher 排除。

### 8.2 验证

```sh
# Prod，Caddy 在前
curl -sI https://host/         | grep -i 'strict-transport\|x-frame\|content-security'
curl -sI https://host/api/v1/sites | grep -i 'content-security'   # 应为空
```

dev 模式：`curl -sI http://localhost:3000/` 应有 `content-security-policy-report-only`，prod 镜像应改为 `content-security-policy`。

## 9. 幂等键（Idempotency-Key）

> 状态：**已实现**（M8 / T37）。

对所有非幂等写入端点（`POST` / `PUT` / `PATCH`），客户端可在请求头加 `Idempotency-Key: <token>` 让平台缓存首次响应；同一调用方在 24 小时内用同一 key + 同一 body 再次请求，会**直接拿到首次响应**，handler 不会被再次执行——避免网络抖动 / Agent 重启导致的重复创建（站点、部署、任务等）。

### 9.1 调用方契约

- **Key 格式**：`^[A-Za-z0-9._-]+$`，长度 `1..256`。常见做法是用 UUID v4 或调用方自己的请求 ID。
- **作用域**：缓存按 `(principalKind, principalId, method, path, key)` 五元组寻址：
  - 不同 admin 用户、不同 API key 之间 key 不会互相干扰。
  - `POST /resources` 与 `PATCH /resources/{id}` 即使带同 key 也走两条独立的缓存路径——它们语义不同。
- **重复请求**：
  - 同 key + 同 body → 回放首次响应，附加 `Idempotent-Replay: true` 响应头。
  - 同 key + 不同 body → `422 idempotency_conflict`。这通常意味着调用方记错了上一次的 input；不会静默吞掉，避免掩盖 bug。
- **TTL**：24 小时（与 IETF draft / Stripe 一致）。

### 9.2 服务端行为

- 在 `withApi` / `withApiKey` / `withAuth` 三个 wrapper 内置（`apps/web/lib/idempotency.ts`），新增端点无需额外接线。
- **存储**：Redis `SETEX`，key 形如 `idem:<principalKind>:<principalId>:<METHOD>:<path>:<idemKey>`。
- **不缓存 5xx**：handler 抛 5xx 视为瞬时故障，重试还能命中下一次 handler 运行；4xx 与 2xx/3xx 都会缓存。
- **Per-request 头会被剥离**：`x-request-id` / `x-ratelimit-*` / `retry-after` / `date` 在回放时由 wrapper 重新写入当前请求的真实值——避免缓存出陈旧的 request-id 或限流余量。
- **Redis 故障降级**：读 / 写缓存失败时 wrapper 选择失败开放——handler 照常执行，不阻断主写入路径；同时打一条 `idempotency.lookup_failed` warn 日志便于运维定位。

### 9.3 验证

```sh
# 同 key + 同 body → 第二次 idempotent-replay: true，body 完全一致
curl -sD - -X POST -H 'authorization: Bearer KEY' \
  -H 'idempotency-key: e6f5a3' -H 'content-type: application/json' \
  -d '{"name":"x","primaryUrl":"https://x.example.com","siteType":"tool","status":"active"}' \
  http://localhost:3000/api/v1/sites

# 同 key + 不同 body → 422 idempotency_conflict
curl -s -X POST -H 'authorization: Bearer KEY' \
  -H 'idempotency-key: e6f5a3' -H 'content-type: application/json' \
  -d '{"name":"different","primaryUrl":"https://y.example.com","siteType":"tool","status":"active"}' \
  http://localhost:3000/api/v1/sites
```
