# T32 — Worker 优雅退出 + drain

- **里程碑**：M7
- **优先级**：P0
- **前置依赖**：T11
- **预估工时**：3 h
- **状态**：Done

## 目标

让 worker 在 SIGTERM / SIGINT 时把当前 in-flight 的 housekeeping / sweep / sync 全部跑完再退出，避免 task 在 `claimed` 状态被截断变成孤儿。

## 范围

**包含**

- 改造 `apps/worker/src/index.ts`：引入 `shutdownState` 标志位 + drain timeout（默认 30s，env `WORKER_SHUTDOWN_TIMEOUT_MS`）
- BullMQ worker 已经支持 `.close()` 等当前 job 结束；housekeeping job 需要在内部尊重 shutdown 信号
- 暴露 `worker.metrics` shape：`{ inFlight: number, drainStartedAt: Date | null }`
- 单测：模拟 SIGTERM 时 housekeeping job 完整跑完才 exit

**不包含**

- BullMQ Bull-Board / queue UI（留 T39）
- Worker HTTP healthz / readyz（留 M11 / 配合 Prom exporter）

## 设计要点

```ts
// apps/worker/src/shutdown.ts
let shuttingDown = false;
const drainPromises: Promise<unknown>[] = [];

export const shutdown = {
  isShuttingDown: () => shuttingDown,
  signal: () => {
    shuttingDown = true;
  },
  track<T>(p: Promise<T>): Promise<T> {
    drainPromises.push(p);
    return p;
  },
  async drain(timeoutMs: number): Promise<void> {
    if (drainPromises.length === 0) return;
    await Promise.race([
      Promise.allSettled(drainPromises),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  },
};
```

```ts
// index.ts shutdown()
async function shutdown(signal: string): Promise<void> {
  shutdown.signal();
  logger.info({ event: 'worker.shutdown_start', signal }, 'draining');
  await Promise.allSettled(workers.map((w) => w.close())); // BullMQ 自带等当前 job
  await shutdown.drain(env.WORKER_SHUTDOWN_TIMEOUT_MS); // 自定义 promise
  await closeQueues();
  logger.info({ event: 'worker.exit' }, 'goodbye');
  process.exit(0);
}
```

- Housekeeping / scheduler 内部长操作（如 sweep loop）轮询 `shutdown.isShuttingDown()`，主动提早收尾
- env 增加 `WORKER_SHUTDOWN_TIMEOUT_MS`（默认 30000）

## 涉及文件

```
apps/worker/src/shutdown.ts                           # 新
apps/worker/src/index.ts                              # 改 shutdown 流程
apps/worker/src/env.ts                                # +WORKER_SHUTDOWN_TIMEOUT_MS
apps/worker/src/jobs/housekeeping.ts                  # 内部使用 shutdown.track
apps/worker/src/__tests__/shutdown.test.ts            # 新
```

## 验收标准

- [x] 单测：mock 一个 housekeeping job 跑 500ms，触发 SIGTERM → 实际 exit 时间 > 500ms
- [x] 单测：drain 超时后强制 exit（避免无限挂起）
- [x] log 中包含 `worker.shutdown_start` 与 `worker.exit` 两条
- [x] 手动：本地 `docker compose stop worker`，进程在 1s 内若无 in-flight 立即退出；有 in-flight 则等到完成
- [x] `pnpm -r typecheck && lint && test` 全绿

## 备注

- `shutdownState` 是 `apps/worker/src/shutdown.ts` 暴露的进程级单例，避免了模块重复 import 造成的多份状态。`signal()` 第二次调用是 no-op，`drainStartedAt` 不会前进；同样 `index.ts` 里加了 `shutdownStarted` 守卫防止 SIGTERM/SIGINT 在 drain 中重入。
- `drain(timeoutMs)` 用 `Promise.race(allSettled, setTimeout)` 实现；setTimeout 计时器 `unref()` 掉以免其延长事件循环。drain 永不抛错，超时仅触发 `worker.shutdown_timeout` warn。
- 把 `processHousekeeping` 单独保留，BullMQ worker 的 processor 改为 `() => shutdownState.track(processHousekeeping())`，既保证 housekeeping 在 SIGTERM 时被 drain 等待，也让 `processHousekeeping` 自身保持纯函数便于 repo 测试复用。
- 单测放在 `apps/worker/src/__tests__/shutdown.test.ts`，纯 in-memory，不依赖 Redis/Postgres。
