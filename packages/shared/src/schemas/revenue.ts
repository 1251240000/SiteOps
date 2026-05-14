/**
 * Zod schemas for the revenue API (T23).
 *
 * Affiliate entries are user-entered (no automated ingestion in M4), so the
 * input contract is intentionally strict: explicit ISO dates, ISO-4217
 * currency, non-negative amounts, capped string lengths. Both the route
 * handler and the service share these schemas — the service layer
 * re-parses on writes to defend against direct calls from worker / agent
 * code that bypass the route layer.
 */
import { z } from 'zod';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

const isoDate = z.string().regex(ISO_DATE_RE, { message: 'must be YYYY-MM-DD' });

const currency = z
  .string()
  .regex(CURRENCY_RE, { message: 'must be ISO-4217 (3 uppercase letters)' });

const amount = z
  .number()
  .finite({ message: 'must be a finite number' })
  .nonnegative({ message: 'must be >= 0' })
  // numeric(10,4) caps at 9_999_999.9999
  .max(9_999_999.9999, { message: 'too large for numeric(10,4)' });

const program = z
  .string()
  .trim()
  .min(1, { message: 'must not be empty' })
  .max(64, { message: 'must be <= 64 chars' });

const notes = z.string().trim().max(2000, { message: 'must be <= 2000 chars' });

export const createAffiliateEntrySchema = z
  .object({
    periodStart: isoDate,
    periodEnd: isoDate,
    program,
    amountUsd: amount,
    amountRaw: amount.optional(),
    currency: currency.optional(),
    payoutDate: isoDate.optional(),
    notes: notes.optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (Date.parse(`${data.periodEnd}T00:00:00Z`) < Date.parse(`${data.periodStart}T00:00:00Z`)) {
      ctx.addIssue({
        code: 'custom',
        path: ['periodEnd'],
        message: '`periodEnd` must be on or after `periodStart`',
      });
    }
  });
export type CreateAffiliateEntryInput = z.infer<typeof createAffiliateEntrySchema>;

export const updateAffiliateEntrySchema = z
  .object({
    periodStart: isoDate.optional(),
    periodEnd: isoDate.optional(),
    program: program.optional(),
    amountUsd: amount.optional(),
    // Allow nullable for clearing a previously-set field via PATCH.
    amountRaw: amount.nullable().optional(),
    currency: currency.nullable().optional(),
    payoutDate: isoDate.nullable().optional(),
    notes: notes.nullable().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.periodStart !== undefined &&
      data.periodEnd !== undefined &&
      Date.parse(`${data.periodEnd}T00:00:00Z`) < Date.parse(`${data.periodStart}T00:00:00Z`)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['periodEnd'],
        message: '`periodEnd` must be on or after `periodStart`',
      });
    }
  });
export type UpdateAffiliateEntryInput = z.infer<typeof updateAffiliateEntrySchema>;
