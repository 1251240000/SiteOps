/**
 * Zod schemas for the ROI / site-costs API (T24).
 *
 * The user-facing form takes loose JSON; this schema enforces the
 * invariants the table can't (number bounds, "first of the month" rule)
 * before we ever round-trip to Postgres. Both the route handler and the
 * service re-parse on writes so direct service callers (worker, agent)
 * pay the same toll as HTTP callers.
 */
import { z } from 'zod';

const MONTH_FIRST_RE = /^\d{4}-\d{2}-01$/;

const amount = z
  .number()
  .finite({ message: 'must be a finite number' })
  .nonnegative({ message: 'must be >= 0' })
  // numeric(10,4) caps at 9_999_999.9999
  .max(9_999_999.9999, { message: 'too large for numeric(10,4)' });

const monthFirstDay = z
  .string()
  .regex(MONTH_FIRST_RE, { message: 'must be the first day of a month (YYYY-MM-01)' });

const notes = z.string().trim().max(2000, { message: 'must be <= 2000 chars' });

export const createSiteCostSchema = z
  .object({
    month: monthFirstDay,
    hostingUsd: amount.default(0),
    domainUsd: amount.default(0),
    contentUsd: amount.default(0),
    adsSpendUsd: amount.default(0),
    otherUsd: amount.default(0),
    notes: notes.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const total =
      data.hostingUsd + data.domainUsd + data.contentUsd + data.adsSpendUsd + data.otherUsd;
    if (total === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['hostingUsd'],
        message: 'at least one cost column must be > 0',
      });
    }
  });
export type CreateSiteCostInput = z.infer<typeof createSiteCostSchema>;

export const updateSiteCostSchema = z
  .object({
    month: monthFirstDay.optional(),
    hostingUsd: amount.optional(),
    domainUsd: amount.optional(),
    contentUsd: amount.optional(),
    adsSpendUsd: amount.optional(),
    otherUsd: amount.optional(),
    notes: notes.nullable().optional(),
  })
  .strict();
export type UpdateSiteCostInput = z.infer<typeof updateSiteCostSchema>;
