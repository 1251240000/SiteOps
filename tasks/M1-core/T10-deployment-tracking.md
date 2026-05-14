# T10 — 部署记录接收与时间线

- **里程碑**：M1
- **优先级**：P0
- **前置依赖**：T08
- **预估工时**：6h
- **状态**：Done

## 目标

接收人工或 CI/Agent 上报的部署事件，存入 deployments 表，并在站点详情页展示时间线。本任务只做"数据接收 + 展示"，外部平台主动同步留给 T17/T18。

## 范围

**包含**

- `deploymentRepo` + `deploymentService`
- API：
  - `POST /api/v1/deployments`（API key required, scope `deployments:write`）
  - `GET /api/v1/deployments`（全局列表）
  - `GET /api/v1/deployments/{id}`
  - `GET /api/v1/sites/{id}/deployments`
- UI：
  - 全局页 `/deployments`：列表（按 started_at 倒序），状态 badge，可按站点过滤
  - 站点详情新增 Deployments 选项卡：时间线视图
- Zod schema：`createDeploymentSchema`（含 provider、provider_deployment_id 必填或 commit_sha 必填二选一）
- 幂等：(provider, provider_deployment_id) 唯一约束；重复 POST 返回已存在记录
- 状态机：queued → building → success / failed / cancelled；只能向前流转

**不包含**

- 直接调用 CF/GH API（在 M3）
- 构建日志解析（仅存 URL）

## 设计要点

- 幂等键：`(provider, provider_deployment_id)`；若 provider 是 manual 则用客户端传的 `Idempotency-Key`。
- duration_ms：service 在收到 finished_at 时自动算。
- triggered_by：枚举校验。
- 时间线 UI：每条 = 状态图标 + commit 短 SHA + branch + provider + 时长；点开看 build log 链接。
- 上报失败的部署也应入库（status=failed），以便排查。

## 涉及文件

```
packages/shared/src/schemas/deployments.ts
packages/db/src/repositories/deployment-repo.ts
packages/db/src/repositories/deployment-repo.test.ts
packages/services/src/deployments/deployment-service.ts
packages/services/src/deployments/deployment-service.test.ts
apps/web/app/api/v1/deployments/route.ts
apps/web/app/api/v1/deployments/[id]/route.ts
apps/web/app/api/v1/sites/[id]/deployments/route.ts
apps/web/app/(dashboard)/deployments/page.tsx
apps/web/app/(dashboard)/sites/[id]/deployments/page.tsx
apps/web/components/deployments/DeploymentList.tsx
apps/web/components/deployments/DeploymentTimeline.tsx
apps/web/components/deployments/DeploymentStatusBadge.tsx
apps/web/lib/queries/deployments.ts
```

## 验收标准

- [x] 用 curl 携带 API key 调 `POST /api/v1/deployments` 成功；重复调用幂等（实测：bearer key with `deployments:write` POST → `201 created=true`；同 `(provider, providerDeploymentId)` 再 POST → `200 created=false` 同 id，状态从 queued → building → success 沿状态机推进）
- [x] 列表与时间线正确展示（`/deployments` 全局表 + per-site `/sites/{id}/deployments` 时间线均 200 渲染，包含 status badge / shortSha / branch / provider / duration / 相对时间 / build log link）
- [x] 状态非法流转（已 success 改回 building）被拒绝（实测 → `409 {"error":{"code":"conflict","message":"Cannot transition deployment from success to building","details":{"from":"success","to":"building","terminal":true}}}`）
- [x] 单测：service 状态机、幂等逻辑（`packages/shared/__tests__/deployments.test.ts` 5 case 覆盖 `canTransitionDeployment`；`packages/services/deployments/__tests__/deployment-service.test.ts` 13 case 覆盖 create + upsert + idempotent + terminal-block + queued→success skip + manual-no-dedupe + duration auto-compute + logger）
- [x] API 集成测试：完整 happy 流 + 鉴权失败 + 幂等返回（实测脚本顺跑 happy 三轮 + 401 无 auth + 409 非法 transition + manual entry 总是新建；`packages/db/repositories/__tests__/deployment-repo.test.ts` 11 case 覆盖 list 排序 / 站点过滤 / 状态/provider 过滤 / 部分唯一索引、`getByProviderId`、`update`）

## 备注

- 后续 T17/T18 会用 service 这层 API 主动同步；这里不要把同步逻辑硬塞进来。
- 幂等键：`(provider, provider_deployment_id)`。新加 migration `0001_deployments_idempotency_uk.sql` 建 `WHERE provider IS NOT NULL AND provider_deployment_id IS NOT NULL` 的 partial unique index，让 `provider='manual'` 且没填 `providerDeploymentId` 的手动条目可以多行共存。
- 状态机：`queued → {building, failed, cancelled}` / `building → {success, failed, cancelled}` / terminal → terminal (拒所有反向)。lateral 自递（webhook 重放）始终接受，便于 CI/Agent 反复重试。详见 `packages/shared/src/constants/deployments.ts::DEPLOYMENT_STATE_TRANSITIONS`.
- `deploymentService.create()` 走 upsert：若已存在则委托 `applyStatusUpdate` 做状态机校验 + patch；否则 `INSERT`。返回 `{ deployment, created }`，API 层据此回 `201` (新建) / `200` (合并)。
- `durationMs` 在收到第一个齐全的 `(startedAt, finishedAt)` 时自动计算并写入；避免客户端各算各的时区。
- API 路由：`GET/POST /api/v1/deployments`、`GET /api/v1/deployments/{id}`、`GET /api/v1/sites/{id}/deployments`。三个都用 `withAuth({ scopes })`：浏览器 session 或 `deployments:read|write` API key 任一即可，符合"Agent + 浏览器"双模式诉求。
- `createDeploymentSchema` 用 `superRefine` 强制 `(provider+providerDeploymentId)` 二者全备 **或** `commitSha` 不为空 —— 拒绝完全无身份的孤儿条目。
- UI：`/deployments` 列表 + per-site `/sites/{id}/deployments` 时间线（GitHub-style vertical rail，每条卡显示 status badge / shortSha / branch / provider / duration / `formatRelativeTime` / build log）。`DeploymentStatusBadge` 与 `formatDuration` 在 list 与 timeline 共享。
- `tabs.tsx` 上 Deployments tab 现在指向真实页面，URL 变 `/sites/{id}/deployments`；之前是占位 404。
