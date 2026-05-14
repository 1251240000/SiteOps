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
  // touched by Next's webpack bundler — keep them external on the server.
  serverExternalPackages: ['pino', 'postgres', 'ioredis', 'bcryptjs'],

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

export default nextConfig;
