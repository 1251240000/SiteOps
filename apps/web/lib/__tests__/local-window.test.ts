/**
 * Unit tests for the in-process LRU sliding window (T31).
 *
 * Uses fake timers so the window-expiry case doesn't need a real sleep.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __peekLocalWindowForTests,
  __resetLocalWindowForTests,
  localHit,
} from '@/lib/local-window';

beforeEach(() => {
  __resetLocalWindowForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('localHit', () => {
  it('starts a fresh bucket on first hit and reports allowed=true', () => {
    const res = localHit('k1', 60, 5);
    expect(res).toMatchObject({ count: 1, allowed: true });
    expect(res.resetAtMs).toBeGreaterThan(Date.now());
  });

  it('increments within the same window and flips allowed when count exceeds limit', () => {
    for (let i = 1; i <= 5; i++) {
      const r = localHit('k2', 60, 5);
      expect(r.count).toBe(i);
      expect(r.allowed).toBe(true);
    }
    const sixth = localHit('k2', 60, 5);
    expect(sixth.count).toBe(6);
    expect(sixth.allowed).toBe(false);
    const seventh = localHit('k2', 60, 5);
    expect(seventh.count).toBe(7);
    expect(seventh.allowed).toBe(false);
  });

  it('resets the bucket once the window expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    for (let i = 0; i < 3; i++) localHit('k3', 60, 5);
    expect(__peekLocalWindowForTests('k3')?.count).toBe(3);

    // Step past resetAt (60s + 1ms).
    vi.setSystemTime(new Date(Date.now() + 60 * 1000 + 1));
    const after = localHit('k3', 60, 5);
    expect(after.count).toBe(1);
    expect(after.allowed).toBe(true);
  });

  it('keeps distinct keys independent', () => {
    localHit('a', 60, 5);
    localHit('a', 60, 5);
    const a3 = localHit('a', 60, 5);
    const b1 = localHit('b', 60, 5);
    expect(a3.count).toBe(3);
    expect(b1.count).toBe(1);
  });

  it('honours per-call windowSec; reset uses the value passed at hit time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const first = localHit('w', 5, 100);
    expect(first.resetAtMs).toBe(Date.now() + 5_000);

    vi.setSystemTime(new Date(Date.now() + 6_000));
    const second = localHit('w', 5, 100);
    expect(second.count).toBe(1);
  });
});
