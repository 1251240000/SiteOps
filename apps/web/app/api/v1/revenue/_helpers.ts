/**
 * Shared helpers for `/api/v1/revenue/*` routes.
 *
 * Revenue and metrics endpoints both consume the same `from`/`to` window
 * conventions (inclusive UTC dates, default trailing 30 days). To stay
 * DRY we just re-export the helpers from the metrics tree — keeping a
 * thin shim here means relative imports inside this subtree are stable
 * even if we later add a revenue-specific concern.
 */
export { defaultRange, isoDateRangeSchema, toIsoDate, type DateWindow } from '../metrics/_helpers';
