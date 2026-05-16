# T26 — Agent 调用审计表与看板

- **里程碑**：M5
- **优先级**：P2
- **前置依赖**：T25（task queue 是 agent_runs 的主要消费者）
- **预估工时**：4h
- **状态**：Todo

## 目标

把"每次 API key 触发的写操作"自动记账到已有的 `agent_runs` 表（M0 已建好），并在 dashboard 出一张表 + 一组 KPI 让 admin 一眼看清「谁在调、调什么、失败率、p95 latency」。同时保留 `input/output` 的原始 JSON，方便事后 debug。

## 范围

**包含**

- 服务封装：`@siteops/services/src/agents/agent-run-service.ts`
  - `record(deps, input)` — 单条写入（手动记录）
  - `wrap(deps, ctx, action, fn)` — 把 handler 函数包起来，自动计时、catch、落库；返回原函数的返回值
  - `list(deps, filters, pagination)` — 查询（含可选 `apiKeyId / agentName / action / status / from / to`）
  - `getById(deps, id)`
  - `summary(deps, range)` — 聚合：count、success_rate、avg_duration、p95_duration（per agent + action）
- 复用 `withApiKey`：新增 `withApiKeyAudited(handler, { action, ...opts })` —— 在 `with-api.ts` 里把 `wrap()` 接进去（透明记录），不动现有调用方
- 现有 `withApiKey` 调用方迁移：`/api/v1/errors`（POST）、`/api/v1/sites`（POST/PATCH 的 API-key 路径）、T25 的 `tasks` agent 端点 全部切到 `withApiKeyAudited`，明确每个的 `action` 名
- 2 条新 REST 接口：
  - `GET /api/v1/agent-runs?apiKeyId&agentName&action&status&from&to&page&limit` —— 列表（admin only）
  - `GET /api/v1/agent-runs/{id}` —— 单条详情，含 `input/output` 完整 JSON
- Dashboard：
  - `/(dashboard)/agent-runs/page.tsx` —— 主页面：KPI 卡（总调用 / 失败率 / p95 latency / 活跃 API key 数）+ 过滤栏 + 表格
  - `components/agent-runs/AgentRunsFilters.tsx` —— 选择 agent_name / action / status / 日期范围（沿用 M4 已有的 `DateRangePicker`）
  - `components/agent-runs/AgentRunsTable.tsx` —— 列：time / agent / action / status / duration / api_key.name / view → 抽屉
  - `components/agent-runs/AgentRunDetailsDrawer.tsx` —— 右侧抽屉：input / output JSON viewer（reuse 现有 `JsonView`，没有就用 `<pre>` + syntax 颜色）
  - `components/agent-runs/AgentRunsKpiRow.tsx`
- 侧栏：在 `app-shell` 的导航里加一条 `/agent-runs`（icon: `Bot` from lucide）

**不包含**

- 重新设计 schema（`agent_runs` 表已经存在，本任务**不写**新迁移）
- 自定义 `agent_name` 的注册管理（自由文本；UI 上做 autocomplete 即可）
- 实时（SSE/WebSocket）刷新；普通分页 + 手动刷新就够
- 跨任务关联：`agent_runs.task_id` —— 见"备注"小段
- 限流 / 配额（M5 不引入；后续看是否真的有滥用问题）

## 数据模型

### 复用 `agent_runs`（M0 / 0000_init.sql）

```text
agent_runs (
  id            uuid pk
  api_key_id    uuid fk → api_keys.id
  agent_name    text
  action        text          -- e.g. 'tasks.claim', 'tasks.complete', 'errors.report'
  input         jsonb
  output        jsonb
  status        text          -- enum: 'success' | 'failed'
  duration_ms   integer
  created_at    timestamptz
)
索引：(api_key_id), (action)
```

本任务**不修改**结构，但要补一个迁移把常用过滤列加索引（既不破坏旧数据也不强制 MAJOR）：

- `0006_agent_runs_indexes.sql`：`CREATE INDEX agent_runs_created_idx ON agent_runs (created_at DESC);` + `CREATE INDEX agent_runs_status_created_idx ON agent_runs (status, created_at DESC);`
- 注意编号：若 T25 已占 `0006_tasks.sql`，本任务排到 **`0007_agent_runs_indexes.sql`**（T25 先合并即可，单人项目顺序由 PR 顺序决定，README 里也注明）。

## API 响应 shape

```ts
type AgentRun = {
  id: string;
  apiKeyId: string;
  apiKey: { id: string; name: string } | null; // 关联展开，方便表格显示
  agentName: string;
  action: string;
  status: 'success' | 'failed';
  durationMs: number | null;
  createdAt: string;
};

// GET /agent-runs/{id} 额外带原始 JSON
type AgentRunDetail = AgentRun & {
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
};

// GET /agent-runs 的 meta（沿用 page/limit 风格，统一 envelope）
type ListMeta = { page: number; limit: number; total: number };
```

## 涉及文件

```
packages/db/migrations/0007_agent_runs_indexes.sql        # +0007 索引；视 T25 合并顺序调整编号
packages/db/migrations/meta/_journal.json                 # 追加
packages/db/src/repositories/agent-run-repo.ts            # 已有空 stub 或新增；CRUD + summary 聚合
packages/db/src/repositories/agent-run-repo.test.ts
packages/db/src/repositories/index.ts                     # 导出

packages/services/src/agents/agent-run-service.ts
packages/services/src/agents/agent-run-service.test.ts
packages/services/src/agents/index.ts
packages/services/src/index.ts                            # 加 agents 命名空间

packages/shared/src/schemas/agent-runs.ts                 # list filters + sort 的 Zod
packages/shared/src/constants/agent-runs.ts               # 已知 action 字符串清单（注释用）

apps/web/lib/with-api.ts                                  # 加 withApiKeyAudited
apps/web/app/api/v1/agent-runs/route.ts                   # GET list
apps/web/app/api/v1/agent-runs/[id]/route.ts              # GET single
apps/web/app/api/v1/agent-runs/__tests__/route.test.ts

apps/web/app/api/v1/errors/route.ts                       # POST 切到 withApiKeyAudited({ action: 'errors.report' })
apps/web/app/api/v1/tasks/claim/route.ts                  # action: 'tasks.claim'  (T25 同期改)
apps/web/app/api/v1/tasks/[id]/complete/route.ts          # action: 'tasks.complete'
apps/web/app/api/v1/tasks/[id]/fail/route.ts              # action: 'tasks.fail'
apps/web/app/api/v1/tasks/[id]/heartbeat/route.ts         # action: 'tasks.heartbeat'

apps/web/app/(dashboard)/agent-runs/page.tsx
apps/web/components/agent-runs/AgentRunsKpiRow.tsx
apps/web/components/agent-runs/AgentRunsFilters.tsx
apps/web/components/agent-runs/AgentRunsTable.tsx
apps/web/components/agent-runs/AgentRunDetailsDrawer.tsx
apps/web/components/layout/app-shell.tsx                  # 侧栏加 nav item
```

## 设计要点

### `withApiKeyAudited` 实现思路

```ts
// lib/with-api.ts
export type AuditedKeyOptions = WithApiKeyOptions & {
  /** 落 agent_runs.action 字段；建议 'noun.verb'。 */
  action: string;
  /** 自定义 agent_name 取值；默认从 query `?agent=` 或 header `x-agent-name` 取，否则 fallback 到 api_key.name。 */
  agentNameFrom?: (req: NextRequest, key: AuthedApiKey) => string;
  /** input 取自 request body 的哪个字段；默认整个 JSON body（仅当 content-type 是 JSON 时）。 */
  inputFrom?: (body: unknown) => unknown;
};

export function withApiKeyAudited(handler: ApiHandler, options: AuditedKeyOptions) {
  return withApiKey(async (req, ctx) => {
    const started = process.hrtime.bigint();
    // body 读一次缓存：route 内可能再次 await req.json()，所以这里给 ctx 注入一个 cached body
    const rawBody = await safeReadJsonClone(req); // 不消耗原 req.body
    const input = options.inputFrom ? options.inputFrom(rawBody) : rawBody;
    const agentName = options.agentNameFrom
      ? options.agentNameFrom(req, ctx.apiKey!)
      : req.headers.get('x-agent-name') ||
        new URL(req.url).searchParams.get('agent') ||
        ctx.apiKey!.name;

    let res: Response;
    let outputForLog: unknown = null;
    let status: 'success' | 'failed' = 'success';
    try {
      res = await handler(req, ctx);
      if (res.status >= 400) {
        status = 'failed';
      }
      outputForLog = await safeReadJsonClone(res);
    } catch (err) {
      status = 'failed';
      outputForLog = { error: err instanceof Error ? err.message : String(err) };
      throw err; // 让 withApi 链路把 AppError 翻译成 JSON
    } finally {
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      // fire-and-forget；DB 写失败不应阻塞 caller
      void agentRunService
        .record(
          { db: getDb(), logger: ctx.logger },
          {
            apiKeyId: ctx.apiKey!.id,
            agentName,
            action: options.action,
            input,
            output: outputForLog,
            status,
            durationMs,
          },
        )
        .catch((err) => ctx.logger.warn({ err }, 'agent-run record failed'));
    }
    return res!;
  }, options);
}
```

注意：

- **不能** 让审计写入阻塞响应：`void ... .catch(...)`，失败只打 warn。
- **不能** 重复消费 request stream：`safeReadJsonClone(req)` 用 `req.clone()` 读，避免后续 `await req.json()` 在 handler 内 EOF。
- 响应 body 同理用 `res.clone()` 读，且仅当 `content-type` 包含 `application/json` 才解析。

### Summary / KPI SQL

KPI 用一条聚合 SQL：

```sql
SELECT
  count(*)                                              AS total,
  count(*) FILTER (WHERE status='failed')               AS failed,
  count(*) FILTER (WHERE status='success')              AS succeeded,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY duration_ms) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
  count(DISTINCT api_key_id)                            AS active_keys
FROM agent_runs
WHERE created_at >= $from AND created_at < $to;
```

按 `agent_name + action` 分组的版本用作"调用排名"小卡，可选项。

### 过滤与分页

- 过滤都是单值或集合：`apiKeyId in (...)`, `status in (success|failed)`, `action like ?`（前缀匹配，例如 `tasks.%`）。
- 默认时间窗 7 天；UI 给 7/30/90 三个快捷选项 + 自定义。
- 默认 `sort=-created_at`，page=1，limit=50。

### 数据保留

- `agent_runs` 没有内置 TTL。housekeeping job 加一步：删除 90 天前的 row（注意需要避开 task 仍可能引用的活动 row —— 实际上 agent_runs 不被任何外键反向引用，可以直接 `DELETE WHERE created_at < now() - interval '90 days'`）。
- 这一条是 SQL 1 行，放进 `housekeeping.ts` 即可，无需新 job。

### 与 T25 的协作

- T25 的 `claim/complete/fail/heartbeat` route 全部走 `withApiKeyAudited`，`action` 与 task 状态机一一对应。
- 当 `tasks.complete` 上报时，`agent_runs.output` 自然落下了 task result —— 多次失败 + 最终成功的全历史可以在 `agent-runs` 里复盘。
- 不在 `agent_runs` 上加 `task_id` 外键（见备注）。

## 验收标准

- [ ] `0007_agent_runs_indexes.sql` 在 fresh DB 上 apply 成功
- [ ] `withApiKeyAudited` 对现有 `errors.report` 路由零行为差异（同样的 201 / 同样的 body），但 `agent_runs` 多一条 success/failed 记录
- [ ] 审计写入失败不影响响应（人为让 `agentRunService.record` 抛错，原 API 仍返回 200/201）
- [ ] `GET /agent-runs` 支持 4 项过滤 + 分页，shape 与 envelope 与 M4 一致
- [ ] `GET /agent-runs/{id}` 返回完整 `input/output` JSON
- [ ] Dashboard `/agent-runs` 渲染最近 7 天：KPI 卡数字与后端 summary 一致；表格行可点开抽屉
- [ ] 单测：
  - service `wrap()`：success / throw 都正确分类并落 duration
  - repo summary：count / success_rate / p95 在固定 fixture 下结果稳定
  - route 401 / 403 / 400 / 200 全部覆盖
- [ ] `pnpm -r typecheck && pnpm -r lint && pnpm -r test` 全绿

## 备注

- **为什么不加 `agent_runs.task_id`**：M5 的 task 是"一种"被审计的对象，未来还会有 `deployments`、`audits`、`alerts` 等。给 `agent_runs` 加每种资源的外键会让表越来越宽。当前用 `input.taskId` / `output.taskId` 这种**结构化但弱类型**的 JSON 字段足够；想要严类型时再加 view。
- **为什么 input/output 都进 JSONB 而不是分两张表**：MVP 量级小（每天 < 10k 行），JSONB 的 GIN 索引（按需后加）就够；分表会让 detail 查询多一个 join，得不偿失。
- **PII 风险**：API key 调用 body 里可能带 url、commit message 等敏感片段。M5 不做脱敏；后续若引入"导出 agent-runs"功能再做 redaction 层。
- "已知 action 清单"建议至少包含：`errors.report`、`tasks.claim`、`tasks.complete`、`tasks.fail`、`tasks.heartbeat`、`deployments.report`、`sites.update`。维护在 `packages/shared/src/constants/agent-runs.ts` 内注释即可。
