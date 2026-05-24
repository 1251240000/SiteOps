/**
 * Helpers for wiring TanStack Query's `useInfiniteQuery` to the
 * cursor-paginated list endpoints introduced in T36.
 *
 * Wire format (matches `apps/web/lib/openapi/common.ts#cursorPaginationMeta`):
 *
 *   {
 *     "data": T[],
 *     "meta": { "cursor": { "next": string | null }, "hasMore": boolean, "limit": number }
 *   }
 *
 * For the four migrated endpoints (`/agent-runs`, `/hooks`, `/errors`,
 * `/sites/{id}/uptime`) the server returns an offset envelope on the first
 * call (no `?cursor=`) and a cursor envelope on every follow-up. We expose
 * `meta.cursor.next` on **both** envelopes so the client can switch into
 * keyset mode after page 1 without an awkward bootstrap; this helper keeps
 * the consumer side blind to that detail.
 */
import type { ApiSuccess } from '../api-client';

/** Cursor envelope shape returned in `meta` on a cursor-paginated response. */
export type CursorMeta = {
  cursor: { next: string | null };
  hasMore: boolean;
  /** Echo of the page size honored by the server. */
  limit: number;
};

/**
 * Loose meta type accepted on the *first* page — the server may still
 * include offset bookkeeping (`page` / `total` / `totalPages`) for
 * back-compat. We only ever read `cursor.next`.
 */
export type MaybeCursorMeta = Partial<CursorMeta> & Record<string, unknown>;

/** A single cursor-paginated page as returned by `apiFetch`. */
export type CursorPage<T> = ApiSuccess<T[]> & { meta?: MaybeCursorMeta };

/**
 * `getNextPageParam` for `useInfiniteQuery`. Returns the encoded cursor for
 * the next page or `null` when the server tells us we're at the tail.
 *
 * We treat both `meta.cursor.next === null` and an empty/missing meta as a
 * terminal state — the server is the source of truth for `hasMore` but the
 * cursor string itself is the only thing we need to issue the follow-up.
 */
export function getNextCursorParam<T>(lastPage: CursorPage<T>): string | null {
  const next = lastPage.meta?.cursor?.next;
  if (typeof next !== 'string' || next.length === 0) return null;
  // Defense in depth: respect `hasMore` if the server explicitly says no.
  if (lastPage.meta?.hasMore === false) return null;
  return next;
}

/**
 * Flatten the `InfiniteData<CursorPage<T>>` produced by `useInfiniteQuery`
 * into a single ordered list of rows. Safe to call before the first fetch
 * resolves (returns `[]`).
 */
export function flattenCursorPages<T>(data: { pages?: CursorPage<T>[] } | undefined): T[] {
  if (!data?.pages) return [];
  const out: T[] = [];
  for (const page of data.pages) {
    if (Array.isArray(page.data)) out.push(...page.data);
  }
  return out;
}

/**
 * Tells `useInfiniteQuery` what to pass as the initial `pageParam`. The
 * first request must omit `?cursor=` so the server falls back to the
 * offset envelope (which carries the bootstrap `cursor.next`).
 */
export const INITIAL_CURSOR: string | null = null;
