/**
 * Error-tracking enums. Mirrored in `@siteops/db` schema; drift is guarded
 * by the db package's `constants-drift.test.ts`.
 */
export const ERROR_SOURCES = ['js', 'build', 'api', 'worker'] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const ERROR_LEVELS = ['error', 'warning'] as const;
export type ErrorLevel = (typeof ERROR_LEVELS)[number];
