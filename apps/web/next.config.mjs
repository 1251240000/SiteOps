import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./lib/i18n/request.ts');

// Hosts that the dev server should treat as same-origin for `/_next/*`
// asset requests. Set `NEXT_DEV_ALLOWED_ORIGINS` (comma-separated) in
// `.env.local` when accessing the dev server via a non-localhost address
// such as a LAN IP, e.g. `NEXT_DEV_ALLOWED_ORIGINS=10.1.1.10,siteops.lan`.
// Without this Next 15 emits a warning ("Cross origin request detected ...
// In a future major version of Next.js, you will need to explicitly
// configure 'allowedDevOrigins' in next.config to allow this.").
const allowedDevOrigins =
  process.env.NEXT_DEV_ALLOWED_ORIGINS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean) ?? [];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // `standalone` output makes `infra/Dockerfile.web` a thin runtime: we copy
  // `.next/standalone` + `.next/static` + `public/` and run `node server.js`.
  output: 'standalone',

  // Transpile workspace packages so their TypeScript source is fed through
  // SWC like the rest of the app (we don't ship their `dist/` to runtime).
  transpilePackages: [
    '@siteops/db',
    '@siteops/services',
    '@siteops/integrations',
    '@siteops/shared',
  ],

  // pino + native Node addons in `postgres-js` / `ioredis` shouldn't be
  // touched by Next's bundler — keep them external on the server.
  serverExternalPackages: ['pino', 'postgres', 'ioredis', 'bcryptjs'],

  ...(allowedDevOrigins.length ? { allowedDevOrigins } : {}),

  reactStrictMode: true,
  poweredByHeader: false,

  // Liveness/readiness probes live at the root of the API surface; the
  // Caddy reverse proxy and Docker HEALTHCHECK both hit `/healthz`.
  async rewrites() {
    return [];
  },

  // Auth.js v5 expects `AUTH_SECRET` at runtime; we don't surface anything to
  // the client bundle here. Public envs (if ever needed) must be prefixed
  // with `NEXT_PUBLIC_` and added explicitly.
  env: {},
};

export default withNextIntl(nextConfig);
