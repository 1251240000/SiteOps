/**
 * Process-wide graceful shutdown coordinator for the worker.
 *
 * BullMQ's `Worker.close()` already waits for the in-flight job to settle,
 * but we also run "extra" promises outside the BullMQ pipeline (e.g. ad-hoc
 * housekeeping sweeps, scheduler fan-outs that survive a tick) and they
 * need a place to register so the shutdown path can drain them too.
 *
 * Contract
 *   - `signal()`           — flip the global flag; safe to call repeatedly.
 *   - `isShuttingDown()`   — long-running processors poll this to exit early.
 *   - `track(promise)`     — keep `promise` alive in the drain set; auto-
 *                            decrements `inFlight` once it settles.
 *   - `drain(timeoutMs)`   — wait for everything tracked OR `timeoutMs`,
 *                            whichever fires first. Never throws.
 *   - `metrics()`          — `{ inFlight, drainStartedAt }` shape for any
 *                            future Prom/OTel exporter (M11).
 *   - `__resetForTests()`  — vitest escape hatch.
 *
 * NOTE: this is a singleton module — multiple workers in the same process
 * share the same drain set, which is exactly what we want for SIGTERM.
 */

let shuttingDown = false;
let drainStartedAt: Date | null = null;
let inFlight = 0;
const drainPromises: Promise<unknown>[] = [];

export type ShutdownMetrics = {
  inFlight: number;
  drainStartedAt: Date | null;
};

export const shutdownState = {
  isShuttingDown(): boolean {
    return shuttingDown;
  },
  signal(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    drainStartedAt = new Date();
  },
  /**
   * Register `promise` so `drain()` will wait for it. Returns the same
   * promise so callers can `await shutdownState.track(doWork())`. Safe to
   * call regardless of `isShuttingDown` — pre-signal promises just bump
   * `inFlight` until they settle.
   *
   * The drain queue only stores a "settled" wrapper (a `.then(ok, err)`
   * chain that resolves on either outcome) so a rejecting input promise
   * does not leak as an unhandled rejection through the queue. The caller
   * is still responsible for handling the returned promise's own
   * rejection — exactly the same contract as the unwrapped value.
   */
  track<T>(promise: Promise<T>): Promise<T> {
    inFlight += 1;
    const decrement = (): void => {
      inFlight = Math.max(0, inFlight - 1);
    };
    drainPromises.push(promise.then(decrement, decrement));
    return promise;
  },
  /**
   * Resolve once every tracked promise settles or `timeoutMs` elapses,
   * whichever comes first. Never rejects.
   */
  async drain(timeoutMs: number): Promise<void> {
    if (drainPromises.length === 0) return;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, Math.max(0, timeoutMs));
      // Don't block process exit on this timer in tests where it
      // could outlive its enclosing run.
      timer.unref?.();
    });
    try {
      await Promise.race([Promise.allSettled(drainPromises).then(() => undefined), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
  metrics(): ShutdownMetrics {
    return { inFlight, drainStartedAt };
  },
  /** Test-only escape hatch — clears every singleton bit. */
  __resetForTests(): void {
    shuttingDown = false;
    drainStartedAt = null;
    inFlight = 0;
    drainPromises.length = 0;
  },
};

export type ShutdownState = typeof shutdownState;
