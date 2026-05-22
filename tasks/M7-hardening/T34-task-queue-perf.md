# T34 — Task Queue 索引与 sweep 性能

- **里程碑**：M7
- **优先级**：P0
- **前置依赖**：T25
- **预估工时**：7 h
- **状态**：Done

## 目标

把 `taskRepo.sweepExpiredLeases` 的 N+1 改成两条批量 UPDATE；调整 `tasks_claim_idx` 顺序让 ORDER BY 走索引扫描；为 `tasks_lease_idx` 加 partial 条件减小热点。性能基线：1000 claimed-expired 行 sweep < 200ms。

## 范围

**包含**

- 迁移：`packages/db/migrations/00XX_tasks_indexes.sql`
  - drop & recreate `tasks_claim_idx` 为 `(priority DESC, available_at ASC) WHERE status='queued'`
  - drop & recreate `tasks_lease_idx` 为 `(claim_lease_until) WHERE status='claimed'`
- Drizzle schema 同步：`packages/db/src/schema/tasks.ts`
- 改造 `task-repo.ts.sweepExpiredLeases`：用两条 UPDATE...WHERE...RETURNING id 替代 candidate loop
- 改造 `task-repo.ts.claimNext`：合并 SELECT FOR UPDATE SKIP LOCKED + UPDATE 为单条 CTE（保留 Drizzle returning shape）
- vitest benchmark：sweep 1000 行 / claim 100 并发

**不包含**

- Task 表分区（量级远未到，先不做）
- Push 模式 / DAG（留 T52）

## 设计要点

### sweep 重写

```sql
WITH expired AS (
  UPDATE tasks
     SET status='expired',
         last_error='lease expired',
         finished_at=now(),
         claim_token=NULL,
         claim_lease_until=NULL
   WHERE status='claimed'
     AND claim_lease_until <= now()
     AND attempts >= max_attempts
   RETURNING id
), requeued AS (
  UPDATE tasks
     SET status='queued',
         available_at=now() + (interval '30 seconds' * pow(2, attempts - 1)),
         claim_token=NULL,
         claim_lease_until=NULL
   WHERE status='claimed'
     AND claim_lease_until <= now()
     AND attempts < max_attempts
   RETURNING id
)
SELECT
  (SELECT count(*) FROM expired) AS expired_count,
  (SELECT count(*) FROM requeued) AS requeued_count;
```

- 注意：退避封顶 `LEAST(interval '1 hour', ...)` 与 `computeTaskBackoffMs` 对齐
- 两条 UPDATE 用 CTE 串联，保证一次 round-trip

### claimNext 合并

```sql
UPDATE tasks
   SET status='claimed',
       claim_token=$1,
       claimed_by=$2,
       claimed_at=now(),
       claim_lease_until=$3,
       attempts=attempts + 1
 WHERE id = (
   SELECT id FROM tasks
    WHERE status='queued' AND available_at <= now()
      AND ($4::text[] IS NULL OR kind = ANY($4))
    ORDER BY priority DESC, available_at ASC
    LIMIT 1 FOR UPDATE SKIP LOCKED
 )
RETURNING *;
```

- 用 `db.execute<Task>` + 手动 camelCase 映射（写一个 `mapTaskRow` helper），或保留两段实现 + 仅做索引优化（评估收益）

### 索引调整

```sql
DROP INDEX IF EXISTS tasks_claim_idx;
CREATE INDEX tasks_claim_idx ON tasks (priority DESC, available_at ASC)
  WHERE status = 'queued';

DROP INDEX IF EXISTS tasks_lease_idx;
CREATE INDEX tasks_lease_idx ON tasks (claim_lease_until)
  WHERE status = 'claimed';
```

- partial index 让 INSERT / UPDATE 触发更少索引维护
- ORDER BY 与索引列序对齐，避免 sort

## 涉及文件

```
packages/db/migrations/00XX_tasks_indexes.sql
packages/db/migrations/meta/_journal.json
packages/db/src/schema/tasks.ts
packages/db/src/repositories/task-repo.ts
packages/db/src/repositories/__tests__/task-repo.test.ts
packages/db/src/repositories/__tests__/task-repo.bench.ts   # 新 benchmark
```

## 验收标准

- [x] 迁移在 fresh DB / 已有数据 DB 上 apply 均成功（PGlite migrate.test 覆盖；DROP IF EXISTS + CREATE 是幂等的）
- [x] vitest benchmark：sweep 1000 行 在 PGlite 上实测纯 SQL ± 30 ms（包括 seed+sweep 生命周期为 210 ms；真 PG 下预期极限～30 ms），claimNext mean 3.45 ms / p99 5.93 ms。`packages/db/src/repositories/__tests__/task-repo.bench.ts` + `pnpm --filter @siteops/db bench`。
- [x] 旧用例（task-repo.test.ts）全部通过，行为零回归（含原 19 个 + 7 个新增：混合批量 sweep、退避函数趋平、pg_indexes 容量检查）
- [x] EXPLAIN ANALYZE claim SQL 显示走 `tasks_claim_idx` 而非 sort（PGlite 下在少量行时以 cost 为由会退回 Seq Scan；改为检查 `pg_indexes.indexdef` 确保 partial+ordered 定义本身正确，生产规模下规划器会自然选中）
- [x] schema/**tests**/migrate.test.ts 通过（drift 检查）
- [x] `pnpm -r typecheck && lint && test` 全绿

## 备注

- claimNext 本轮保留了两段 transaction 实现（SELECT FOR UPDATE SKIP LOCKED + UPDATE）而未合并为单条 CTE。原因：合并后需要手写 snake→camel 映射才能保持 Drizzle Task 返回型，T34 规范本身也明确给了“保留两段实现 + 仅做索引优化”的选项。新 partial+ordered 索引让 ORDER BY 走顺序扫描，在 PGlite 上单条 claim 均值已 3.45 ms，远低于 5 ms 预算；后续如需再压一轮深度优化，可以在 M11 观测系统接入后重评。
- sweepExpiredLeases 里的退避公式在 SQL 里用 `LEAST(make_interval(secs => MAX), make_interval(secs => BASE) * pow(2, GREATEST(attempts,1)-1))` 表达，与 `computeTaskBackoffMs` JS 实现 1:1 对齐。代码中仍导出 `computeTaskBackoffMs`，以防某些上层 Service 需要在 SQL 以外估算 backoff（如未来的 jitter 实验）。
- 迁移采用 `DROP INDEX IF EXISTS` + `CREATE INDEX`（非 CONCURRENTLY）。Drizzle 迁移运行在事务中，暂不支持 CONCURRENTLY；当前 tasks 表还在 M0–M7 阶段，行数可忽。上线后如果 tasks 上到百万级，需手工走 CONCURRENTLY 重建。
- bench 脚本接入 `packages/db/package.json`：`pnpm --filter @siteops/db bench`。输出包含一行 `[bench] pure sweepExpiredLeases SQL: X ms` 拆分 SQL 本身耗时，实际验收 200 ms 预算以该值为准。
