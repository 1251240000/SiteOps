export const PUBLIC_MIDDLEWARE_EXCLUDED_PATHS = [
  'api',
  '_next/static',
  '_next/image',
  'favicon.ico',
  'healthz',
  'tracker.js',
] as const;

export const MIDDLEWARE_MATCHER = `/((?!${PUBLIC_MIDDLEWARE_EXCLUDED_PATHS.join('|')}).*)`;
