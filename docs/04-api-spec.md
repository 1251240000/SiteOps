# 04 · API 设计规范

## 1. 总则

- **风格**：REST + JSON。资源为名词复数，动作用 HTTP 方法。
- **路径前缀**：`/api/v1/`。版本永远显式。
- **认证**：
  - 浏览器：cookie session（Auth.js）
  - 程序：`Authorization: Bearer <api_key>`
- **内容类型**：`Content-Type: application/json; charset=utf-8`。
- **时间格式**：ISO 8601 with offset，例如 `2026-05-12T08:30:00.000Z`。
- **分页**：cursor 分页 `?cursor=<id>&limit=<n>`，limit 最大 100、默认 20。
- **筛选**：query string，例如 `?site_type=tool&status=active`。
- **排序**：`?sort=-created_at` （`-` 为降序）。
- **校验**：所有入参用 Zod schema；失败返回 400 + 详细字段错误。
- **幂等**：`POST` 若需幂等，要求客户端带 `Idempotency-Key` header。

## 2. 标准响应

成功：

```json
{
  "data": { ... } | [ ... ],
  "meta": { "cursor": "abc", "hasMore": true }
}
```

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

| code                | HTTP | 说明                  |
| ------------------- | ---- | --------------------- |
| `validation_failed` | 400  | 入参校验失败          |
| `unauthorized`      | 401  | 未登录或 API key 无效 |
| `forbidden`         | 403  | 已认证但无权限        |
| `not_found`         | 404  | 资源不存在            |
| `conflict`          | 409  | 唯一约束冲突          |
| `rate_limited`      | 429  | 命中限流              |
| `upstream_failed`   | 502  | 外部 API 错误         |
| `internal_error`    | 500  | 未分类错误            |

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

## 4. Webhook 入口（站点端 → 平台）

| 路径                            | 用途                       |
| ------------------------------- | -------------------------- |
| `POST /api/v1/hooks/cloudflare` | CF Pages 部署事件回调      |
| `POST /api/v1/hooks/github`     | GitHub Actions / push 事件 |

签名校验必须开启（HMAC）。

## 5. 限流

- 浏览器 session：每 IP 60 req/min。
- API key：默认 600 req/min，可在 `api_keys.scopes` 之外用 `rate_limit` 字段覆盖。
- 实现：内存 + Redis token bucket（小流量直接 Redis）。

## 6. 版本演进

- 增字段、加可选参数：v1 内兼容。
- 改语义、删字段、改返回结构：开 `/api/v2/`。
- 弃用走 `Deprecation` + `Sunset` 响应头。

## 7. OpenAPI

- 用 `zod-to-openapi` 自动生成 spec，挂在 `/api/v1/openapi.json`。
- Swagger UI 可选挂 `/api/v1/docs`（仅 dev/staging）。
