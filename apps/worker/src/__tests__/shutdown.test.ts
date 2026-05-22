/**
 * Unit tests for the worker graceful-shutdown coordinator (T32).
 *
 * The actual `process.exit` flow lives in `index.ts` and is not exercised
 * here because it would have to boot Redis. Instead we cover the
 * coordinator's contract: `track` keeps things alive, `drain` waits up to
 * `timeoutMs`, the timeout path doesn't hang, and second `signal()` calls
 * are no-ops.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { shutdownState } from '../shutdown.js';

afterEach(() => {
  shutdownState.__resetForTests();
});

describe('shutdownState', () => {
  it('starts in a clean state', () => {
    expect(shutdownState.isShuttingDown()).toBe(false);
    const m = shutdownState.metrics();
    expect(m.inFlight).toBe(0);
    expect(m.drainStartedAt).toBeNull();
  });

  it('signal() flips the flag and stamps drainStartedAt; second call is a no-op', async () => {
    expect(shutdownState.isShuttingDown()).toBe(false);
    shutdownState.signal();
    expect(shutdownState.isShuttingDown()).toBe(true);
    const first = shutdownState.metrics().drainStartedAt;
    expect(first).toBeInstanceOf(Date);

    // Wait a tick and re-signal — drainStartedAt must NOT advance.
    await new Promise((r) => setTimeout(r, 10));
    shutdownState.signal();
    const second = shutdownState.metrics().drainStartedAt;
    expect(second?.getTime()).toBe(first?.getTime());
  });

  it('track() bumps inFlight and decrements when the promise settles', async () => {
    let resolveJob!: () => void;
    const job = new Promise<void>((r) => {
      resolveJob = r;
    });
    const tracked = shutdownState.track(job);

    expect(shutdownState.metrics().inFlight).toBe(1);

    resolveJob();
    await tracked;
    // Allow the .finally hook to run.
    await Promise.resolve();
    expect(shutdownState.metrics().inFlight).toBe(0);
  });

  it('track() returns the original promise (so callers can await it)', async () => {
    const result = shutdownState.track(Promise.resolve(42));
    await expect(result).resolves.toBe(42);
  });

  it('track() decrements inFlight even when the tracked promise rejects', async () => {
    const tracked = shutdownState.track(Promise.reject(new Error('boom')));
    expect(shutdownState.metrics().inFlight).toBe(1);
    await expect(tracked).rejects.toThrow('boom');
    // Allow the .finally hook to run.
    await Promise.resolve();
    expect(shutdownState.metrics().inFlight).toBe(0);
  });

  it('drain() waits for tracked promises (mocked 500ms housekeeping job)', async () => {
    const JOB_MS = 500;
    const housekeepingJob = new Promise<void>((r) => setTimeout(r, JOB_MS));
    shutdownState.track(housekeepingJob);

    shutdownState.signal();
    const t0 = Date.now();
    await shutdownState.drain(5_000);
    const elapsed = Date.now() - t0;

    // Allow ~50ms slop for timer resolution / event loop.
    expect(elapsed).toBeGreaterThanOrEqual(JOB_MS - 50);
    expect(shutdownState.metrics().inFlight).toBe(0);
  });

  it('drain() returns when the timeout wins and never throws', async () => {
    // Promise that never resolves on its own.
    const unresolvable = new Promise<void>(() => undefined);
    shutdownState.track(unresolvable);

    shutdownState.signal();
    const t0 = Date.now();
    await expect(shutdownState.drain(50)).resolves.toBeUndefined();
    const elapsed = Date.now() - t0;

    // Should be ~50ms; allow generous upper bound for slow CI hosts.
    expect(elapsed).toBeLessThan(1_000);
    // The unresolvable promise is still in flight — the worker process
    // would log `worker.shutdown_timeout` and force exit.
    expect(shutdownState.metrics().inFlight).toBe(1);
  });

  it('drain() returns immediately when nothing is tracked', async () => {
    const t0 = Date.now();
    await shutdownState.drain(10_000);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  it('isShuttingDown() lets long-running processors short-circuit', async () => {
    // Simulate a sweep loop that polls between phases. Before signal it
    // does the real work; after signal it bails on the next iteration.
    let phasesRun = 0;
    const sweep = async (): Promise<void> => {
      for (let i = 0; i < 10; i += 1) {
        if (shutdownState.isShuttingDown()) return;
        phasesRun += 1;
        await new Promise((r) => setTimeout(r, 5));
      }
    };

    const work = shutdownState.track(sweep());
    await new Promise((r) => setTimeout(r, 12));
    shutdownState.signal();
    await work;

    expect(phasesRun).toBeGreaterThanOrEqual(1);
    expect(phasesRun).toBeLessThan(10);
  });
});
