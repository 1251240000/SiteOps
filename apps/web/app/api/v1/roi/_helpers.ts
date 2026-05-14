/**
 * Shared helpers for `/api/v1/roi/*` routes.
 *
 * Same `from`/`to` window contract as the metrics + revenue endpoints —
 * we re-export from the metrics tree so a future change to the default
 * window or validation rules propagates automatically.
 */
export { defaultRange, isoDateRangeSchema, toIsoDate, type DateWindow } from '../metrics/_helpers';
