# T52 — Task 编排（DAG / cron / push 回调）

- **里程碑**：M12
- **优先级**：P2
- **前置依赖**：T25, T34
- **预估工时**：10 h
- **状态**：Todo

## 目标

把 tasks 表从"单个 unit"扩展到能表达：① 父子依赖（DAG）；② 周期重复（cron template）；③ push 回调（状态变化时主动通知客户 URL）。

## 范围

**包含**

- 迁移：
  - `tasks` 加列：`parent_id UUID REFERENCES tasks(id) ON DELETE SET NULL`、`cron_expression TEXT`、`is_template BOOLEAN NOT NULL DEFAULT false`、`callback_url TEXT`、`callback_secret_hash TEXT`
  - 索引：`tasks_parent_idx ON tasks(parent_id)`、`tasks_template_cron_idx ON tasks(is_template, cron_expression) WHERE is_template = true AND cron_expression IS NOT NULL`
- service 扩展：
  - `taskService.enqueue` 支持 `parentId`、`callbackUrl`、`cronExpression`、`isTemplate`
  - 新 `taskService.materializeChildren(parentId)`：父进入 `succeeded` 时把直接子任务从 `pending`→`queued`（子任务初始 status='pending' 等父）
  - 新 service：`cronExpansionService`：worker scheduler 每分钟扫描 active templates，按 cron 实例化新 task
- 新状态：`pending`（等父亲完成）加入 `TASK_STATUS`
- Push 回调：状态变化时入 `outbound_webhook_deliveries`（复用 T45 表）或独立 task callbacks 表
- BullMQ scheduler：`task-cron-expansion` 每分钟运行
- 测试覆盖：parent fail → children remain pending；parent cancel → children cancel；cron 跳过 already queued

**不包含**

- 多父依赖（仅 1:N 父子）
- 可视化 DAG 编辑器（先 API）
- 跨 site 的全局并发限制

## 设计要点

### 状态机扩展

```
新状态 'pending' = 等待父亲；不能被 claim
parent succeeded → children pending → queued（available_at = now）
parent failed/expired/cancelled → children 自动 cancel（链式）
```

### Cron 实例化

```ts
// services/src/tasks/cron-expansion-service.ts
async function tick(deps, now: Date) {
  const templates = await taskRepo.listActiveCronTemplates(deps.db);
  for (const tmpl of templates) {
    const nextFire = nextCronTime(tmpl.cronExpression, tmpl.lastFiredAt ?? tmpl.createdAt);
    if (nextFire > now) continue;
    if (await taskRepo.hasActiveInstance(deps.db, tmpl.id)) continue; // 已有未完成实例 → 跳过
    await taskService.enqueue(deps, {
      kind: tmpl.kind,
      siteId: tmpl.siteId,
      payload: tmpl.payload,
      priority: tmpl.priority,
      maxAttempts: tmpl.maxAttempts,
      parentId: null,
      // 关联模板（额外 column or payload 注入）
    });
    await taskRepo.markTemplateFired(deps.db, tmpl.id, now);
  }
}
```

- 用 `cron-parser` 解析表达式
- 限制最小粒度 1min（与 scheduler 跑频对齐）

### Push 回调

```ts
// state transition 处
await deliveryRepo.enqueue({
  kind: 'task.state_changed',
  url: task.callbackUrl,
  secret: decrypt(task.callbackSecretHash),
  payload: { taskId, oldStatus, newStatus, result, error },
});
// 复用 T45 的 outbound-webhook-dispatch worker
```

或独立简化版（小一些）：tasks 表加 `callback_url`，worker 内直接 HTTP POST + 1 次重试。

### 子任务调度

```ts
// after task complete
if (task.parentId === null) return;
// 当父完成时由 service 触发 materialize（已经在 complete 路径）

// 复杂情况：多个子并行 → 用 listChildrenPending(parentId) 一次性 queued
```

## 涉及文件

```
packages/db/migrations/00XX_tasks_orchestration.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/tasks.ts                          # 加列 + 状态枚举
packages/db/src/repositories/task-repo.ts                # 新 helper
packages/shared/src/constants/tasks.ts                    # TASK_STATUS + 'pending'
packages/shared/src/schemas/tasks.ts                      # CreateTaskInput 加 parentId/cron/...
packages/services/src/tasks/task-service.ts               # 新方法
packages/services/src/tasks/cron-expansion-service.ts     # 新
packages/services/src/tasks/task-callback-service.ts      # push 回调
apps/worker/src/jobs/task-cron-expansion.ts                # 新 job
apps/worker/src/schedulers/task-cron-scheduler.ts          # 注册
apps/worker/src/index.ts                                   # 启动
apps/web/app/api/v1/tasks/route.ts                          # 加 input 字段
docs/04-api-spec.md                                         # tasks 端点更新
docs/15-task-orchestration.md                                # 新文档
```

## 验收标准

- [ ] 迁移 apply 成功
- [ ] 单测：parent 进入 succeeded → 立刻把 children 从 pending → queued
- [ ] 单测：parent 进入 failed/expired/cancelled → children 全部 cancelled
- [ ] 单测：cron 模板每分钟产生 1 个实例，已有 active 实例时跳过
- [ ] 单测：push 回调收到正确 payload + HMAC
- [ ] e2e：admin 创建 3 层 DAG → 跑通最后子任务
- [ ] e2e：cron 模板 `'* * * * *'` → 等待 1 分钟看到新实例
- [ ] `pnpm -r typecheck && lint && test` 全绿
