# M12 · Agent 生态

> 让外部 Agent 的接入门槛降到"几行代码"，并把任务队列从最小可用扩展到能编排长流程的工程化能力。

## 里程碑目标

4 块 Agent / Task 能力扩展：

1. **官方 SDK**：现在外部 Agent 要自己实现 claim → heartbeat → complete 循环；提供 `@siteops/agent` 封装。
2. **任务编排**：tasks 表加 `parent_id`（依赖链）、`cron_expression`（重复入队）、`callback_url`（push 模式）。
3. **录入 UI + 重放**：dashboard 当前没有"新建任务"模态，admin 仍走 curl；同时缺 task replay / bulk patch。
4. **Agent fleet 视图**：现在 `/agent-runs` 是按调用查；缺以 agent 为主体的 fleet 视图（最近心跳、并发上限、健康状态）。

## 任务清单

| ID                                 | 标题                           | 状态 | 估时 | 前置     |
| ---------------------------------- | ------------------------------ | ---- | ---: | -------- |
| [T51](./T51-agent-sdk.md)          | @siteops/agent SDK 包          | ⬜   |  8 h | T25, T35 |
| [T52](./T52-task-orchestration.md) | Task 编排（DAG / cron / push） | ⬜   | 10 h | T25, T34 |
| [T53](./T53-task-ui-replay.md)     | Task 录入 / 重放 / 批量操作 UI | ⬜   |  6 h | T25      |
| [T54](./T54-agent-fleet-view.md)   | Agent fleet 视图 + 心跳        | ⬜   |  4 h | T26      |

## 数据模型扩展

```sql
ALTER TABLE tasks
  ADD COLUMN parent_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  ADD COLUMN cron_expression TEXT,          -- 周期入队（仅 template 任务）
  ADD COLUMN template_id UUID REFERENCES tasks(id),
  ADD COLUMN callback_url TEXT,             -- push 模式回调
  ADD COLUMN callback_secret TEXT;          -- HMAC

CREATE TABLE agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  api_key_id    UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  concurrency   INT NOT NULL DEFAULT 1,
  last_seen_at  TIMESTAMPTZ,
  health_status TEXT NOT NULL DEFAULT 'unknown',  -- ok | warning | down
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 不在 M12 范围

- DAG 可视化编辑器（先 API 后 UI）
- Agent 自动伸缩 / scheduling
- 跨平台 SDK（仅 TypeScript / Node；Python 留 v3）

## 里程碑完成条件

- [ ] `npm i @siteops/agent` + 10 行代码跑通 claim 循环
- [ ] task `parent_id` 链：父成功后子自动 queued
- [ ] task `cron_expression='0 * * * *'` 每小时自动 enqueue 新实例
- [ ] task 状态变化时 callback_url 收到 HMAC POST
- [ ] dashboard 新建任务模态：选 kind / 填 payload / 提交
- [ ] `/agents` 页面显示当前 fleet 的最近心跳、并发数
- [ ] `pnpm -r typecheck && lint && test` 全绿
