# T15 — 错误聚合接收端

- **里程碑**：M2
- **优先级**：P1
- **前置依赖**：T08
- **预估工时**：5h
- **状态**：Done

## 目标

为被管站点提供一个轻量错误上报接口（不重建 Sentry，只做聚合 + 列表 + 解决标记）。

## 范围

**包含**

- API：
  - `POST /api/v1/errors`（API key required, scope `errors:write`）—— 接收单条或批量上报
  - `GET /api/v1/errors?siteId=&level=&resolved=` —— 列表（按 last_seen_at 倒序）
  - `PATCH /api/v1/errors/{id}` —— 标记 resolved / 清空 resolved
  - `DELETE /api/v1/errors/{id}` —— 软删（resolved + hide）
- 聚合：用 message + 简化 stack（去掉 line:col）SHA-256 算 fingerprint；同 fingerprint 自动 count++ 并更新 last_seen_at
- UI：
  - `/(dashboard)/errors`：列表 + 过滤 + 单条详情抽屉
- 轻量 JS SDK（占位）：`packages/integrations/src/error-sdk/`，仅 README + 示例代码片段（实际 SDK 不在 MVP 范围）

**不包含**

- Source map 解析
- 性能追踪
- 用户会话回放

## 设计要点

- 上报 payload：
  ```json
  {
    "siteId": "uuid",
    "source": "js" | "build" | "api" | "worker",
    "level": "error" | "warning",
    "message": "string",
    "stack": "string?",
    "meta": { "url": "...", "ua": "...", "version": "..." }
  }
  ```
- fingerprint：`sha256(source + level + message + simplifiedStack)`。
- 上报限流：单 API key 100 req/min（避免被恶意填库）。
- 列表分页 cursor；默认隐藏 resolved 行。
- 详情抽屉：完整 stack + meta + 一键复制。

## 涉及文件

```
packages/shared/src/schemas/errors.ts
packages/db/src/repositories/error-repo.ts
packages/db/src/repositories/error-repo.test.ts
packages/services/src/errors/error-service.ts
packages/services/src/errors/error-service.test.ts
packages/services/src/errors/fingerprint.ts
packages/services/src/errors/fingerprint.test.ts
apps/web/app/api/v1/errors/route.ts
apps/web/app/api/v1/errors/[id]/route.ts
apps/web/app/(dashboard)/errors/page.tsx
apps/web/components/errors/ErrorList.tsx
apps/web/components/errors/ErrorDetailDrawer.tsx
packages/integrations/src/error-sdk/README.md      # 仅文档，无运行代码
```

## 验收标准

- [x] 用 curl 多次上报同一错误，count 递增、last_seen_at 更新（`errorRepo.upsert` 路径 + `errorTrackingService.report` 返回 `created` 标记）
- [x] 不同 message 产生不同 fingerprint（`fingerprint.test.ts` 验证间隔 / 大小写 / 堆栈行号差异下的稳定性）
- [x] 列表 + 详情可用（`/(dashboard)/errors` + `ErrorDetailDrawer`）
- [x] 标记 resolved 后默认列表不显示（`errorRepo.list` 默认 `resolved=false`）
- [x] 单测：fingerprint 稳定性（`fingerprint.test.ts` 6 test）

## 备注

- meta 字段允许任意 JSON；写入前限制大小 ≤ 32KB，超大截断。
- 后续可加 alert rule "1 分钟内 error_count > N"（T16 已规划支持自定义指标）。
