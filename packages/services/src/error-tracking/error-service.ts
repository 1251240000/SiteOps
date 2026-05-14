/**
 * Error-tracking service.
 *
 * Thin facade over `errorRepo`: computes the fingerprint, normalises the
 * payload, and emits a single structured log line per call.
 */
import { errorRepo, type Db, type ErrorRow } from '@siteops/db';
import {
  AppError,
  type Logger,
  type ReportErrorInput,
  type UpdateErrorInput,
} from '@siteops/shared';

import { fingerprint as fingerprintFn } from './fingerprint.js';

export type ErrorTrackingDeps = {
  db: Db;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
};

export type ReportResult = {
  row: ErrorRow;
  /** True if a new row was created (vs. existing row incremented). */
  created: boolean;
};

export const errorTrackingService = {
  async report(deps: ErrorTrackingDeps, input: ReportErrorInput): Promise<ReportResult> {
    const fp = fingerprintFn({
      source: input.source,
      level: input.level,
      message: input.message,
      stack: input.stack ?? null,
    });
    const { row, created } = await errorRepo.upsert(deps.db, {
      siteId: input.siteId,
      source: input.source,
      level: input.level,
      fingerprint: fp,
      message: input.message,
      stack: input.stack ?? null,
      meta: input.meta ?? null,
    });
    deps.logger?.info(
      {
        event: 'error.reported',
        errorId: row.id,
        siteId: input.siteId,
        source: input.source,
        level: input.level,
        fingerprint: fp,
        created,
        count: row.count,
      },
      'error reported',
    );
    return { row, created };
  },

  async list(
    deps: ErrorTrackingDeps,
    opts: Parameters<typeof errorRepo.list>[1] = {},
  ): Promise<ReturnType<typeof errorRepo.list>> {
    return errorRepo.list(deps.db, opts);
  },

  async getById(deps: ErrorTrackingDeps, id: string): Promise<ErrorRow> {
    const row = await errorRepo.getById(deps.db, id);
    if (!row) {
      throw new AppError('Error not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    return row;
  },

  async update(deps: ErrorTrackingDeps, id: string, patch: UpdateErrorInput): Promise<ErrorRow> {
    const row = await errorRepo.setResolved(deps.db, id, patch.resolved);
    if (!row) {
      throw new AppError('Error not found', { code: 'not_found', status: 404, details: { id } });
    }
    deps.logger?.info(
      { event: 'error.updated', errorId: id, resolved: patch.resolved },
      'error updated',
    );
    return row;
  },

  /** Soft-delete: mark resolved and lose from default listings. */
  async softDelete(deps: ErrorTrackingDeps, id: string): Promise<ErrorRow> {
    const row = await errorRepo.setResolved(deps.db, id, true);
    if (!row) {
      throw new AppError('Error not found', { code: 'not_found', status: 404, details: { id } });
    }
    deps.logger?.info({ event: 'error.deleted', errorId: id }, 'error soft-deleted');
    return row;
  },
};

export { fingerprintFn as fingerprint };
