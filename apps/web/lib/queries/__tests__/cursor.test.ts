/**
 * Unit tests for the cursor helper that wires `useInfiniteQuery` to the
 * cursor-paginated list endpoints (T36 frontend).
 */
import { describe, expect, it } from 'vitest';

import { flattenCursorPages, getNextCursorParam, INITIAL_CURSOR, type CursorPage } from '../cursor';

type Row = { id: string };

describe('getNextCursorParam', () => {
  it('returns the encoded cursor when the server says there is more', () => {
    const page: CursorPage<Row> = {
      data: [{ id: 'a' }],
      meta: { cursor: { next: 'enc-1' }, hasMore: true, limit: 50 },
    };
    expect(getNextCursorParam(page)).toBe('enc-1');
  });

  it('returns null when cursor.next is null (end of list)', () => {
    const page: CursorPage<Row> = {
      data: [{ id: 'a' }],
      meta: { cursor: { next: null }, hasMore: false, limit: 50 },
    };
    expect(getNextCursorParam(page)).toBeNull();
  });

  it('returns null when cursor.next is an empty string', () => {
    const page: CursorPage<Row> = {
      data: [{ id: 'a' }],
      meta: { cursor: { next: '' as unknown as string }, hasMore: true, limit: 50 },
    };
    expect(getNextCursorParam(page)).toBeNull();
  });

  it('returns null when meta is absent', () => {
    const page: CursorPage<Row> = { data: [] };
    expect(getNextCursorParam(page)).toBeNull();
  });

  it('returns null when meta is missing cursor entirely', () => {
    const page: CursorPage<Row> = {
      data: [{ id: 'a' }],
      meta: { page: 1, limit: 50, total: 1, totalPages: 1 },
    };
    expect(getNextCursorParam(page)).toBeNull();
  });

  it('honors hasMore=false even if cursor.next is non-empty (server is authoritative)', () => {
    const page: CursorPage<Row> = {
      data: [{ id: 'a' }],
      meta: { cursor: { next: 'enc-1' }, hasMore: false, limit: 50 },
    };
    expect(getNextCursorParam(page)).toBeNull();
  });

  it('accepts offset envelope that *also* exposes cursor.next (bootstrap from page 1)', () => {
    const page: CursorPage<Row> = {
      data: [{ id: 'a' }],
      meta: {
        page: 1,
        limit: 50,
        total: 120,
        totalPages: 3,
        cursor: { next: 'enc-after-page-1' },
        hasMore: true,
      },
    };
    expect(getNextCursorParam(page)).toBe('enc-after-page-1');
  });
});

describe('flattenCursorPages', () => {
  it('returns [] when data is undefined (pre-first-fetch)', () => {
    expect(flattenCursorPages<Row>(undefined)).toEqual([]);
  });

  it('returns [] when pages is empty', () => {
    expect(flattenCursorPages<Row>({ pages: [] })).toEqual([]);
  });

  it('concatenates rows from every page in order', () => {
    const pages: CursorPage<Row>[] = [
      { data: [{ id: 'a' }, { id: 'b' }] },
      { data: [{ id: 'c' }] },
      { data: [{ id: 'd' }, { id: 'e' }] },
    ];
    expect(flattenCursorPages({ pages }).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('tolerates a malformed page whose data is not an array', () => {
    const pages = [
      { data: [{ id: 'a' }] },
      { data: undefined as unknown as Row[] },
      { data: [{ id: 'b' }] },
    ];
    expect(flattenCursorPages<Row>({ pages }).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('INITIAL_CURSOR', () => {
  it('is null so the first request omits ?cursor= (server returns offset envelope)', () => {
    expect(INITIAL_CURSOR).toBeNull();
  });
});
