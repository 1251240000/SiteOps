/**
 * Keyset cursor encode / decode helpers (T36).
 *
 * High-volume tables (`agent_runs`, `webhook_events`, `uptime_checks`,
 * `errors`) all paginate with `(ts, id)` keyset cursors instead of `OFFSET`
 * once the page count grows beyond a few thousand. Encoding the cursor as
 * `base64url(JSON.stringify({ id, ts }))` keeps it opaque to clients while
 * still being trivially debuggable in a REPL.
 *
 * Contract:
 *   - `id` is always a `string` — UUIDs round-trip as-is, `bigserial` ids
 *     are stringified by the repo before encoding so the wire format is
 *     uniform across tables.
 *   - `ts` is an ISO 8601 timestamp string (`Date#toISOString()` output).
 *   - Invalid / tampered cursors decode to `null`; the route layer is
 *     expected to translate that to a 400 with `code=validation_failed`.
 *
 * The encoder is pure (no DB / IO) and safe to use from both server and
 * tooling code.
 */

export type Cursor = {
  /** Stable row identifier — UUID or stringified bigint. */
  id: string;
  /** ISO 8601 timestamp matching the row's ordering column. */
  ts: string;
};

/** Encode a cursor for use in `?cursor=...`. */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ id: c.id, ts: c.ts }), 'utf8').toString('base64url');
}

/**
 * Decode a cursor string. Returns `null` for any malformed input
 * (bad base64, non-JSON body, missing/invalid fields, non-parseable ts).
 * Callers should treat `null` as a validation error.
 */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let json: string;
  try {
    json = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['id'] !== 'string' || obj['id'].length === 0) return null;
  if (typeof obj['ts'] !== 'string' || obj['ts'].length === 0) return null;
  const ms = Date.parse(obj['ts']);
  if (Number.isNaN(ms)) return null;
  return { id: obj['id'], ts: obj['ts'] };
}

/**
 * Clamp a raw `limit` query parameter into `[1, max]`. Non-finite or
 * undefined inputs fall back to `def`. Floats are floored so the wire
 * format is forgiving (e.g. `limit=20.5` → `20`).
 */
export function clampLimit(raw: number | null | undefined, def: number, max = 100): number {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return def;
  const n = Math.floor(raw);
  if (n < 1) return 1;
  if (n > max) return max;
  return n;
}
