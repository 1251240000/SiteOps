# T25 — Task Queue REST 接口（给 Agent 用）

- **里程碑**：M5
- **优先级**：P2
- **前置依赖**：T06（API key 认证），T08（site 引用）
- **预估工时**：8h
- **状态**：Todo

## 目标

提供一条"admin 入队 → Agent 领取 → 汇报结果"的标准 pull-mode 队列接口。Agent 用 API key 拉任务，平台只负责把任务状态、租约、重试维护好；不引入新的中间件（不开 RabbitMQ / Kafka / SQS），直接用 Postgres `FOR UPDATE SKIP LOCKED` 实现原子领取。

## 范围

**包含**

- 新表 `tasks`（详见"数据模型"）
- 迁移：`packages/db/migrations/0006_tasks.sql` + `meta/_journal.json` 追加
- Drizzle schema：`packages/db/src/schema/tasks.ts` + 注册到 `schema/index.ts`
- Repo：`packages/db/src/repositories/task-repo.ts`
  - `create`, `getById`, `list(filters, pagination)`, `findByDedupeKey`
  - `claimNext(opts)` — 原子领取一条；用 `SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1` 再 `UPDATE`
  - `extendLease(id, claimToken, ttl)`, `complete(id, claimToken, result)`, `fail(id, claimToken, error)`
  - `requeueExpired(now)` — 由 housekeeping job 周期调用，回收过期租约
- service：`@siteops/services/src/tasks/task-service.ts`
  - 同名方法封装 repo，外加 Zod 校验、状态机校验、agent_runs 副作用（在 T26 接通；本任务先留 hook 点）
- 7 条 REST 接口（全部 `apps/web/app/api/v1/tasks/...`）：
  - `POST   /api/v1/tasks` — 入队（admin session **或** `tasks:write`）
  - `GET    /api/v1/tasks` — 列表（`tasks:read` 或 admin）
  - `GET    /api/v1/tasks/{id}` — 详情（`tasks:read` 或 admin）
  - `PATCH  /api/v1/tasks/{id}` — admin 专属：cancel / 调 priority / 调 max_attempts
  - `POST   /api/v1/tasks/claim` — Agent 领取下一条（`tasks:claim`）
  - `POST   /api/v1/tasks/{id}/heartbeat` — 延长租约（`tasks:claim`）
  - `POST   /api/v1/tasks/{id}/complete` — 完成上报（`tasks:claim`）
  - `POST   /api/v1/tasks/{id}/fail` — 失败上报（`tasks:claim`）
- housekeeping：在 `apps/worker/src/jobs/housekeeping.ts` 加一步 `tasks.requeueExpired(now)`，重用现有调度
- Zod schemas：`packages/shared/src/schemas/tasks.ts`（共享给 route + service）

**不包含**

- Web UI（admin 录入仍走 `curl` / SDK；下一个里程碑或 M6 再做"任务列表 / 入队表单"）
- 多消费者队列（Agent 名字进 `claimed_by`，但不做按 agent 名的优先分配）
- 通知（任务进入 `failed` 不自动发告警；如需要由 admin 加 alert rule 监 `tasks_failed_count`）
- 定时任务（cron-style 重复入队）

## 数据模型

### `tasks`

```sql
CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL,                       -- e.g. 'content.draft', 'audit.run', 'deployment.trigger'
  site_id         UUID REFERENCES sites(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'queued',      -- queued|claimed|succeeded|failed|cancelled|expired
  priority        SMALLINT NOT NULL DEFAULT 0,         -- 数值大 → 先取（DESC）
  payload         JSONB,                                -- 入队时给 Agent 的输入
  result          JSONB,                                -- complete 时 Agent 回写的输出
  dedupe_key      TEXT,                                 -- 可选；同 key 第二次 POST 返回同一行
  attempts        SMALLINT NOT NULL DEFAULT 0,
  max_attempts    SMALLINT NOT NULL DEFAULT 3,
  available_at    TIMESTAMPTZ NOT NULL DEFAULT now(),   -- 可领取时间（用于失败退避）
  claimed_by      UUID REFERENCES api_keys(id),         -- 当前持有租约的 API key
  claim_token     UUID,                                 -- complete/fail/heartbeat 必带；server 校验
  claim_expires_at TIMESTAMPTZ,                         -- 租约到期
  last_error      TEXT,
  created_by      UUID REFERENCES users(id),            -- admin 入队时填；外部系统入队时为 NULL
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- claim 选 next 的核心索引：先按状态过滤、再按 available_at + priority 排序
CREATE INDEX tasks_queue_idx
  ON tasks (status, available_at, priority DESC)
  WHERE status = 'queued';

CREATE INDEX tasks_site_idx       ON tasks (site_id);
CREATE INDEX tasks_status_idx     ON tasks (status);
CREATE INDEX tasks_claim_exp_idx  ON tasks (claim_expires_at) WHERE status = 'claimed';

-- 同 dedupe_key 只能存活 1 条 active；succeeded/failed/cancelled/expired 不参与去重
CREATE UNIQUE INDEX tasks_dedupe_active_uk
  ON tasks (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('queued', 'claimed');

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('queued','claimed','succeeded','failed','cancelled','expired'));
ALTER TABLE tasks
  ADD CONSTRAINT tasks_attempts_check
  CHECK (attempts >= 0 AND attempts <= max_attempts);
```

### 状态机

```
       enqueue                           claim(token, ttl)
queued ─────────────► queued ─────────────────────────────► claimed
   ▲                                                          │
   │ requeueExpired                          heartbeat (extend)
   │                                                          │
   │           fail(attempts<max,                              ▼
   │             backoff = 2^attempts*30s)            complete(result)
   ├──────────────────────────────────────────         ─────────────────► succeeded
   │                                                          │
   │           fail(attempts>=max)                            │
   ├──────────────────────────────────────────────────────────┘
   │                                                          │
   ▼                                                          ▼
expired                                                    failed
(claim 超时未上报)                                  (终态，由 attempts 用尽决定)
              admin PATCH {status: cancelled}     →  cancelled (任何非终态可取消)
```

退避策略：失败重排队时 `available_at = now() + 30s * 2^(attempts-1)`，封顶 1h。

## API 响应 shape

```ts
type TaskStatus = 'queued' | 'claimed' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

type Task = {
  id: string;
  kind: string;
  siteId: string | null;
  status: TaskStatus;
  priority: number;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  availableAt: string; // ISO
  claimedBy: { id: string; name: string } | null;
  claimExpiresAt: string | null;
  lastError: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

// POST /tasks
type CreateTaskInput = {
  kind: string; // ≤ 64 chars, [a-z0-9._-]+
  siteId?: string;
  priority?: number; // -100..100，默认 0
  payload?: Record<string, unknown>;
  maxAttempts?: number; // 1..10，默认 3
  dedupeKey?: string; // ≤ 200 chars
  availableAt?: string; // ISO，未来时间 → 延迟任务
};

// POST /tasks/claim
type ClaimRequest = {
  kinds?: string[]; // 按 kind 过滤（OR）
  leaseSeconds?: number; // 默认 60，最大 600
};
type ClaimResponse =
  | { data: null } // 队列暂空（200，meta.idle=true）
  | {
      data: Task & { claimToken: string }; // 200/201；token 仅这一次返回
      claimToken: string;
    }; // duplicated for ergonomics

// POST /tasks/{id}/complete | fail | heartbeat
type CompleteRequest = { claimToken: string; result?: Record<string, unknown> };
type FailRequest = { claimToken: string; error: string; retry?: boolean };
type HeartbeatRequest = { claimToken: string; leaseSeconds?: number };
```

幂等约定：

- `POST /tasks` 带 `dedupe_key` 且匹配到 active row → 返回 200 + 现有 row，`meta.idempotent=true`；新建则返回 201 + `meta.created=true`。沿用 T10 部署 idempotency 的 envelope 风格。
- `complete / fail` 校验 `claim_token` 必须匹配；不匹配返回 409 `conflict`。
- 任意终态再 `complete / fail` → 409。

## 涉及文件

```
packages/shared/src/constants/tasks.ts                 # status / kind 校验常量
packages/shared/src/schemas/tasks.ts                   # Zod schemas
packages/db/src/schema/tasks.ts
packages/db/migrations/0006_tasks.sql
packages/db/migrations/meta/_journal.json              # +0006
packages/db/src/repositories/task-repo.ts
packages/db/src/repositories/task-repo.test.ts
packages/db/src/repositories/index.ts                  # 导出
packages/db/src/schema/index.ts                        # 导出
packages/db/src/schema/__tests__/migrate.test.ts       # expected tables += 'tasks'

packages/services/src/tasks/task-service.ts
packages/services/src/tasks/task-service.test.ts
packages/services/src/tasks/index.ts
packages/services/src/index.ts                         # 加 tasks 命名空间

apps/web/app/api/v1/tasks/route.ts                     # GET list / POST create
apps/web/app/api/v1/tasks/[id]/route.ts                # GET / PATCH
apps/web/app/api/v1/tasks/claim/route.ts               # POST claim
apps/web/app/api/v1/tasks/[id]/heartbeat/route.ts
apps/web/app/api/v1/tasks/[id]/complete/route.ts
apps/web/app/api/v1/tasks/[id]/fail/route.ts
apps/web/app/api/v1/tasks/__tests__/route.test.ts

apps/worker/src/jobs/housekeeping.ts                   # 增 requeueExpired step
apps/worker/src/jobs/__tests__/housekeeping.test.ts
```

## 设计要点

### 为什么不用 BullMQ

- 已经有 BullMQ 跑 worker 内部 job（uptime / lighthouse / sync）。但那些是 **server → server**，闭环在容器内。
- M5 的"任务"目标受众是 **外部 Agent**：要的是 HTTP + Bearer + 平等的状态查询。把 BullMQ 暴露给外部会带来鉴权、连接、回放等复杂度。
- 任务规模上限：每天 < 1000 条；Postgres `FOR UPDATE SKIP LOCKED` 在这个量级上吊打任何专用 broker（实测百行/秒不在话下）。
- 复用现有 housekeeping job 处理过期回收，不引入新进程。

### 原子领取实现

```ts
// task-repo.ts
async function claimNext(
  db: Db,
  opts: { kinds?: string[]; apiKeyId: string; leaseSeconds: number },
) {
  return db.transaction(async (tx) => {
    const candidate = await tx.execute(sql`
      SELECT id FROM tasks
      WHERE status = 'queued'
        AND available_at <= now()
        ${opts.kinds?.length ? sql`AND kind = ANY(${opts.kinds})` : sql``}
      ORDER BY priority DESC, available_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);
    if (!candidate.rows[0]) return null;
    const id = candidate.rows[0].id as string;
    const claimToken = crypto.randomUUID();
    const claimExpiresAt = new Date(Date.now() + opts.leaseSeconds * 1000);
    const [row] = await tx
      .update(tasks)
      .set({
        status: 'claimed',
        claimedBy: opts.apiKeyId,
        claimToken,
        claimExpiresAt,
        attempts: sql`${tasks.attempts} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(tasks.id, id))
      .returning();
    return { row, claimToken };
  });
}
```

注意：

- `attempts` 在领取时 +1，而不是在 `fail` 时 +1。这样如果 Agent 崩了不上报，过期回收时 `attempts` 已经计入，不会无限领。
- 事务内 update 在 SKIP LOCKED 锁住的同一行上完成，单条 SQL 保证原子。

### 过期回收

`apps/worker/src/jobs/housekeeping.ts` 每分钟一次：

```ts
await taskService.requeueExpired(deps, new Date());
```

逻辑（在 `taskRepo`）：

```sql
UPDATE tasks
SET status = CASE WHEN attempts >= max_attempts THEN 'expired' ELSE 'queued' END,
    available_at = CASE WHEN attempts >= max_attempts THEN available_at
                        ELSE now() + INTERVAL '30 seconds' * pow(2, attempts - 1) END,
    claimed_by = NULL,
    claim_token = NULL,
    claim_expires_at = NULL,
    last_error = COALESCE(last_error, 'claim_expired'),
    updated_at = now()
WHERE status = 'claimed' AND claim_expires_at < now()
RETURNING id;
```

logger 写一行 `event: 'tasks.requeue_expired', count: N`。

### `withAuth` 复用

- `POST /tasks` 用 `withAuth({ scopes: ['tasks:write'] })`，让 admin session 也能直接走（dashboard 或 curl 都行）。
- `POST /tasks/claim`、`complete`、`fail`、`heartbeat` 用 `withApiKey({ scopes: ['tasks:claim'] })`，明确拒绝 session 来源（这些是 Agent 行为，不应该用 admin cookie）。
- `GET /tasks` 用 `withAuth({ scopes: ['tasks:read'] })`。

### Idempotency-Key vs dedupe_key

- HTTP `Idempotency-Key` header 在本任务**不实现**（M3 部署 API 已经走 provider+id 的应用级 idempotency 模式，本表沿用）。
- `dedupe_key` 是 **任务级业务键**：同 site + 同 program + 同周期等"不该重复执行"的场景，调用方自己生成。

### Service 层接口

```ts
export const taskService = {
  async enqueue(deps, input: CreateTaskInput): Promise<{ task: Task; created: boolean }>;
  async list(deps, filters, pagination): Promise<{ items: Task[]; total: number }>;
  async getById(deps, id: string): Promise<Task>;
  async patch(deps, id: string, patch: { status?: 'cancelled'; priority?: number; maxAttempts?: number }): Promise<Task>;

  async claimNext(deps, apiKeyId: string, opts: ClaimRequest): Promise<{ task: Task; claimToken: string } | null>;
  async heartbeat(deps, id: string, claimToken: string, leaseSeconds?: number): Promise<Task>;
  async complete(deps, id: string, claimToken: string, result?: unknown): Promise<Task>;
  async fail(deps, id: string, claimToken: string, error: string, retry?: boolean): Promise<Task>;

  async requeueExpired(deps, now: Date): Promise<number>;
};
```

`deps = { db: Db; logger: Logger }`，沿用 M3 / M4 现有 service 风格。

## 验收标准

- [ ] 迁移 `0006_tasks.sql` 在 fresh DB 上 apply 成功；`schema/__tests__/migrate.test.ts` 把 `'tasks'` 加入 expected list 并通过
- [ ] Repo 单测覆盖：CRUD、`claimNext` 并发安全（5 个并发 claim 必须互斥拿到 5 个不同 row）、`findByDedupeKey`
- [ ] Service 单测覆盖：
  - dedupe_key 重复入队 → idempotent
  - 状态机：claimed → succeeded/failed 走通；succeeded 再 complete 返回 409
  - `attempts >= max_attempts` 时 fail 直接进 `failed`，不再回 queued
  - `requeueExpired` 把已过期 claimed 行回 queued，attempts 不再 +1
- [ ] 路由单测：
  - 401 无 token；403 scope 不足；200/201 envelope 与 meta 正确
  - `claim` 队列空时 200 + `data:null` + `meta.idle:true`
  - `complete` claimToken 不匹配 → 409 `conflict`
- [ ] `curl` 走通端到端：admin 入队 → 用 API key claim → heartbeat → complete → GET 单条状态为 succeeded
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿

## 备注

- `claim_token` 作为短期凭据放在响应体里（不在 cookie / header），由 Agent 自己保存。它不是长期 secret，过期 / 完成 / 失败后立刻失效；不需要进 audit log。
- `kind` 不做 enum check（只做正则）：业务种类会随 Agent 演进，留口子；但建议在 `packages/shared/src/constants/tasks.ts` 里维护一份 "已知 kind 清单 + 文档注释"，供 dashboard 自动补全。
- 后续若要加 **push 模式**（webhook callback Agent），在 `tasks` 表加 `callback_url` + `callback_secret`，状态变化时触发；这是 v2 的事。
