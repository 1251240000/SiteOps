import { z } from 'zod';

/**
 * Offset/limit pagination. Defaults chosen to match `docs/04-api-spec.md`.
 * `limit` caps at 100 to prevent runaway queries.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

/**
 * Opaque cursor pagination. Cursor encoding is the caller's concern
 * (typically `base64(JSON({ id, createdAt }))`); this schema only enforces
 * the wire shape.
 */
export const cursorSchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CursorPagination = z.infer<typeof cursorSchema>;

/** Generic paginated response envelope. */
export type Page<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};

/** Generic cursor-paginated response envelope. */
export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
};
