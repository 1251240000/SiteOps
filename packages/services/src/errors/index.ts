/**
 * Re-export the canonical error hierarchy so callers don't need to know
 * whether the error originates from `@siteops/shared` or a service helper.
 */
export { AppError, UpstreamError, ValidationError, isAppError } from '@siteops/shared';
export type { AppErrorOptions } from '@siteops/shared';
