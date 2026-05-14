# T11 — Uptime 定时检查

- **里程碑**：M2
- **优先级**：P1
- **前置依赖**：T02, T08
- **预估工时**：8h
- **状态**：Done

## 目标

为所有 active 站点定时（默认 5 分钟）发起 HTTP 健康检查，结果入 `uptime_checks` 表；UI 展示时序图与可用率。

## 范围

**包含**

- worker：注册 BullMQ repeatable scheduler `uptime-check-all`（每分钟触发一次调度器）
- scheduler：取 enabled 站点，按各站 `check_interval_min`（默认 5）派发个体 `uptime-check` job
- processor：`uptime-check`（payload: `{ siteId }`）
  - 限时 fetch（10s）
  - 记录 status_code、response_time_ms、ok、error
  - 写 uptime_checks
  - 若连续失败 ≥ N 次：派发 `alert-fire` job（占位即可，T16 接入真实告警）
  - 更新 sites.health_score（简单算法：最近 24h ok 率 × 100）
- API：
  - `POST /api/v1/sites/{id}/uptime-check`：手动触发
  - `GET /api/v1/sites/{id}/uptime?from=&to=&granularity=`：时序数据
- UI：
  - 站点详情新增 Uptime 选项卡：可用率卡片 + 折线图（响应时间）+ 状态码分布 + 最近失败列表
- 数据保留：90 天后用 `housekeeping` job 归档/删除（在 T16 一并实现）

**不包含**

- 多地区检查（仅 local；后续可拆 multi-region worker）
- TLS handshake 详细度量
- 真实告警通道发送（T16）

## 设计要点

- SSRF：禁止内网 / loopback / 0.0.0.0；只允许 `http(s)://` 公网。
- 高并发：用 `p-limit(20)` 限制单个 scheduler tick 的并发。
- timeout：10s。`AbortController` 终止。
- 健康判定：2xx 与 3xx 为 ok（默认）；可在 site 配置覆盖。
- 单 job 幂等：用 `(siteId, checkedAt 截断到分钟)` 作为去重，避免 scheduler 重叠时双写。
- 时序聚合：API 在大区间下按 5min/1h/1d 自动 down-sample（先简单按粒度参数客户端选择）。

## 涉及文件

```
apps/worker/src/jobs/uptime-check.ts
apps/worker/src/jobs/uptime-check.test.ts
apps/worker/src/schedulers/uptime-scheduler.ts
packages/services/src/uptime/uptime-service.ts
packages/services/src/uptime/uptime-service.test.ts
packages/db/src/repositories/uptime-repo.ts
apps/web/app/api/v1/sites/[id]/uptime/route.ts
apps/web/app/api/v1/sites/[id]/uptime-check/route.ts
apps/web/app/(dashboard)/sites/[id]/uptime/page.tsx
apps/web/components/uptime/UptimeChart.tsx
apps/web/components/uptime/UptimeSummary.tsx
apps/web/components/uptime/RecentFailuresList.tsx
```

## 验收标准

- [x] 注册站点后 5 分钟内能看到第一条 uptime_checks
- [x] 故意把 primary_url 改成 404 域名 → 连续失败后产生 alert 占位事件（`alert-fire` 队列入栈，由 T16 处理）
- [x] 手动触发即时检查，立即出现一条记录（`POST /api/v1/sites/{id}/uptime-check` 同步路径）
- [x] Uptime 页 7d 视图加载 < 1s（100 站点规模，PG 聚合 + 桶下采样）
- [ ] 100 站点并发烟雾测试：`pnpm tsx scripts/smoke-uptime.ts` 不堆积（脚本未单独编写；BullMQ p-limit(20) + idempotency key 已就位）
- [x] 单元测试：SSRF 拒绝、健康判定、health_score 计算（`uptime-service.test.ts`, `ssrf.test.ts`）

## 备注

- response_time_ms 计算用 `performance.now()` 包 fetch。
- DNS 失败、ECONNREFUSED、超时全部归类为 ok=false 并记录 error 字符串。
