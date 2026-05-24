# M8 · API 契约与一致性

> 把 `docs/04-api-spec.md` 规划过但未落地的契约项一次性补齐，让外部 Agent / 客户端能基于稳定、可机读的接口集成。

## 里程碑目标

5 类契约债：

1. **OpenAPI 自动生成**：spec §7 写明但未实现；Zod schema 已经全在 `packages/shared/src/schemas/*`，用 `@asteasolutions/zod-to-openapi` 输出即可。
2. **Cursor 分页**：spec §1 约定 cursor，实现全是 offset/page。高频长表（agent_runs、webhook_events、uptime_checks、errors）数据增长后 OFFSET 性能崩塌；翻页 + 新数据涌入还会重复/漏读。
3. **Idempotency-Key**：spec §1 §9 约定 HTTP 头幂等，T37 已落地——三个 wrapper 内置；同 key 重复 POST/PUT/PATCH 不会重复创建。
4. **API key 自定义限流**：spec §5 提到 `api_keys.rate_limit` 单 key 限流覆盖，未实现。流量大户和 dashboard cookie 用户混用同一全局 budget。
5. **system 端点 + Bull-Board**：spec §3.10 列出 `/system/version` / `/system/jobs`；admin 想看队列只能 redis-cli。

## 任务清单

| ID                                         | 标题                                  | 状态 | 估时 | 前置     |
| ------------------------------------------ | ------------------------------------- | ---- | ---: | -------- |
| [T35](./T35-openapi-generation.md)         | OpenAPI 生成 + Swagger UI + CI parity | ✅   |  8 h | T25, T27 |
| [T36](./T36-cursor-pagination.md)          | Cursor 分页迁移（高频长表）           | ✅   |  8 h | T11, T26 |
| [T37](./T37-idempotency-key-middleware.md) | Idempotency-Key HTTP 中间件           | ✅   |  5 h | T06      |
| [T38](./T38-api-key-rate-override.md)      | API Key 自定义限流 + system 端点      | ✅   |  6 h | T06, T11 |
| [T39](./T39-bull-board-admin.md)           | Bull-Board 队列管理面板               | ✅   |  3 h | T11      |

## 不在 M8 范围

- API 版本升级到 v2（仍 v1 内兼容）
- Webhook outbound（留 T45）
- API key UI 自助生成限流（仅服务端 DB 列 + admin 后台改）

## 里程碑完成条件

- [ ] `curl /api/v1/openapi.json` 返回完整 OpenAPI 3.1 spec，覆盖所有 v1 路由
- [ ] dev 模式可访问 `/api/v1/docs` Swagger UI 调试
- [ ] CI 跑 `pnpm openapi:check` 检测 spec 与代码漂移
- [ ] `GET /agent-runs?cursor=...&limit=20` 替代旧 page 参数（page 保留兼容）
- [x] `POST /sites` 带 `Idempotency-Key: abc` 二次调用返回首次结果，不创建新 row
- [ ] `api_keys.rate_limit` 字段生效，可在 DB 直接 UPDATE 覆盖默认 600/min
- [ ] `/api/v1/system/version` 与 `/api/v1/system/jobs` 端点可用
- [ ] `/admin/queues` Bull-Board 可访问（需 admin session）
- [ ] `pnpm -r typecheck && lint && test` 全绿
