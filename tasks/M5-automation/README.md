# M5 · 自动化对接

> 把 siteops 从「人盯仪表盘」推进到「Agent / 外部系统主动驱动」：任务队列、调用审计、被动 webhook 接收三件套全部就绪。

## 里程碑目标

M0–M4 把数据采集、监控、运营看板都建好了，但所有"动作"还要 admin 手动点 UI。M5 把入口翻过来：

1. **任务队列**：admin（或将来的规则引擎、cron）把待办塞进 `tasks` 表，外部 Agent 用 API key 拉取、领取、汇报，平台只关心结果。
2. **调用审计**：每次 API key 触发的写操作都落进 `agent_runs`（M0 就建好的表），dashboard 用一张表 + KPI 卡解决"谁在调、调多少、失败多少、慢不慢"。
3. **被动 Webhook**：CF Pages 与 GitHub Actions 的事件不再靠每小时 cron 拉取，而是真正的事件驱动入库，复用 T17/T18 的 service 落地到 `deployments`。

## 任务清单

| ID                                  | 标题                                | 状态 | 估时 | 前置     |
| ----------------------------------- | ----------------------------------- | ---- | ---: | -------- |
| [T25](./T25-task-queue-api.md)      | Task Queue REST 接口（给 Agent 用） | ⬜   |  8 h | T06, T08 |
| [T26](./T26-agent-runs-tracking.md) | Agent 调用审计表与看板              | ⬜   |  4 h | T25      |
| [T27](./T27-webhook-receiver.md)    | CF / GitHub webhook 接收            | ⬜   |  6 h | T17, T18 |

## 数据流概览

```
  admin / cron / rule-engine ──► POST /tasks ──► tasks (queued)
                                                    │
        外部 Agent (API key)  ──► POST /tasks/claim─┤ (FOR UPDATE SKIP LOCKED)
                                                    ▼
                                              tasks (claimed) ──► heartbeat
                                                    │
                                    success ◄──┬──► fail ──► attempts++ → queued / expired
                                                    │
                                            agent_runs 写一行（T26）
                                                    │
                                    Dashboard /agent-runs 聚合 KPI

  CF Pages    ──webhook──► POST /hooks/cloudflare ─┐
                                                    ├─► webhook_events (idempotent by delivery_id)
  GitHub      ──webhook──► POST /hooks/github     ─┘                  │
                                                                       ▼
                                              deploymentService.create / upsert
```

所有外部入口（task claim、agent 汇报、webhook）都走 `withApiKey` 或 HMAC 校验；不开匿名 POST。

## 新增数据表

| 表名             | 任务 | 用途                                 |
| ---------------- | ---- | ------------------------------------ |
| `tasks`          | T25  | Agent 任务队列（pull 模式 + 租约）   |
| `webhook_events` | T27  | 已接收 webhook 的幂等去重 + 失败重放 |

`agent_runs` 在 M0 已经建好，T26 仅写入 / 查询并补一条索引迁移。两张新表的迁移分别走 `0006_tasks.sql`、`0008_webhook_events.sql`（中间 `0007_agent_runs_indexes.sql` 给 T26）。

## 新增 / 复用的 scope

API key `scopes` 字段已存在，本里程碑约定的 scope 命名：

| Scope             | 谁用                   | 允许的动作                            |
| ----------------- | ---------------------- | ------------------------------------- |
| `tasks:read`      | 仪表盘 / 只读 Agent    | `GET /tasks`, `GET /tasks/{id}`       |
| `tasks:write`     | 系统 / 触发器          | `POST /tasks`、`PATCH /tasks/{id}`    |
| `tasks:claim`     | 执行型 Agent           | `claim / heartbeat / complete / fail` |
| `agent-runs:read` | 审计员（一般给 admin） | `GET /agent-runs`                     |

`*` 仍然是 super-key（M0 已实现）。

## 不在 M5 范围

- 实时 push / WebSocket / SSE 向 Agent 推送任务（pull 模式足够 MVP）
- 多租户 / 多 admin（仍是 single-admin）
- 任务编排 DAG（一个 task 一个 unit；Agent 自己组合）
- Webhook 重放 UI（先有数据兜底，UI 留到 v2）
- 把 BullMQ 队列暴露成 REST（`/system/jobs` 已经在 M2 提供）
- 双向：平台主动调 Agent 的 callback URL（pull 即可）
- 任何 UI 国际化（移到 M6）

## 里程碑完成条件

- [ ] `pnpm dev` 下用 `curl + Bearer` 走完 enqueue → claim → heartbeat → complete 全流程
- [ ] 同一 `dedupe_key` 重复 `POST /tasks` 返回同一个 task（200，非 201）
- [ ] CF webhook 与 GH workflow_run 真实事件能落库并创建 / 更新 `deployments` 行
- [ ] 同一 `delivery_id` 重放二次 webhook 不会写出多条 deployments
- [ ] `/(dashboard)/agent-runs` 能按 agent / action / status 过滤，并显示 p95 latency
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿
- [ ] `tasks/README.md` 顶部状态表 M5 行翻 ✅
