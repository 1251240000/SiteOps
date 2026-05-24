# T54 — Agent fleet 视图 + 心跳

- **里程碑**：M12
- **优先级**：P2
- **前置依赖**：T26
- **预估工时**：4 h
- **状态**：Todo

## 目标

把 `/agent-runs`（按调用查）补一个互补视角：以 agent 为主体的 fleet 视图 —— 最近心跳、并发上限、健康状态、关联 API key —— 方便 admin 评估 fleet 容量。

## 范围

**包含**

- 迁移：新表 `agents`
  ```sql
  CREATE TABLE agents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL UNIQUE,
    api_key_id    UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    concurrency   INT NOT NULL DEFAULT 1,
    last_seen_at  TIMESTAMPTZ,
    health_status TEXT NOT NULL DEFAULT 'unknown',  -- ok | warning | down
    metadata      JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX agents_api_key_idx ON agents (api_key_id);
  ```
- Service：`agentService.upsertHeartbeat(name, apiKeyId, metadata)`
- 自动注册：T26 现有 agent_runs 写入时（`x-agent-name` 头）调 `upsertHeartbeat`，无需 Agent 主动调注册接口
- 路由：
  - `GET /api/v1/agents` — 列表
  - `GET /api/v1/agents/{id}` — 详情 + 最近 20 次 runs
  - `PATCH /api/v1/agents/{id}` — 设 `concurrency`（admin only）
- Health 计算：scheduler 每分钟跑一次 `agent-health-tick`：
  - `last_seen_at < 5min` → ok
  - `5min ≤ last_seen_at < 30min` → warning
  - `last_seen_at ≥ 30min` → down
- UI：`/(dashboard)/agents` 列表 + 详情页

**不包含**

- Agent 自动 scaling / scheduling
- Agent → siteops 反向控制（admin 在 dashboard 命令 agent restart）

## 设计要点

### Heartbeat 注入

```ts
// with-api.ts withApiKeyAudited 调用前后
// 已有 agentName 解析逻辑（header / query / api key name）
// 同步调 agentService.upsertHeartbeat：
void agentService.upsertHeartbeat(deps, {
  name: agentName,
  apiKeyId: apiKey.id,
  metadata: { ip: req.headers.get('x-forwarded-for') },
});
```

- 写失败不影响请求
- 1s 内多次心跳 throttled（per-process LRU）

### Health 计算

```sql
UPDATE agents
   SET health_status = CASE
     WHEN last_seen_at >= now() - INTERVAL '5 minutes' THEN 'ok'
     WHEN last_seen_at >= now() - INTERVAL '30 minutes' THEN 'warning'
     ELSE 'down'
   END,
   updated_at = now();
```

scheduler `agent-health-tick` 每 60s 跑一次。

### UI

```
/agents
  ┌──────────────────┬──────────┬──────────────┬──────────┐
  │ name             │ health   │ last_seen    │ concurrency
  │ content-runner-1 │ ok       │ 12s ago      │ 4        │
  │ audit-runner     │ warning  │ 12m ago      │ 2        │
  │ legacy-bot       │ down     │ 3h ago       │ 1        │
  └──────────────────┴──────────┴──────────────┴──────────┘
```

详情页：最近 20 次 agent_runs + 调用 KPI（成功率、p95、call/min）

## 涉及文件

```
packages/db/migrations/00XX_agents.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/agents.ts
packages/db/src/schema/index.ts
packages/db/src/repositories/agent-repo.ts
packages/services/src/agents/agent-service.ts
packages/services/src/agents/index.ts                        # 导出
packages/shared/src/schemas/agents.ts
apps/web/lib/with-api.ts                                      # withApiKeyAudited 注入 heartbeat
apps/web/app/api/v1/agents/route.ts                           # 新
apps/web/app/api/v1/agents/[id]/route.ts                      # 新
apps/web/app/(dashboard)/agents/page.tsx                      # 新
apps/web/app/(dashboard)/agents/[id]/page.tsx                 # 新
apps/web/lib/queries/agents.ts                                # 新
apps/worker/src/jobs/agent-health-tick.ts                     # 新
apps/worker/src/schedulers/agent-health-scheduler.ts          # 新
apps/worker/src/index.ts                                       # 注册
apps/web/components/sidebar.tsx                                # 加 /agents 入口
```

## 验收标准

- [ ] 一次 task claim 后对应 agent.last_seen_at 更新
- [ ] 30 分钟无心跳 → health 自动转 'down'
- [ ] `/agents` 显示当前 fleet，按 health 排序
- [ ] PATCH 改 concurrency 后行内立即反映
- [ ] viewer 只读，operator+admin 可改 concurrency
- [ ] `pnpm -r typecheck && lint && test` 全绿
