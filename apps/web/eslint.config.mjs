import siteopsConfig from '@siteops/eslint-config';
import globals from 'globals';

/**
 * Per-app overrides on top of the shared flat config:
 * - allow browser globals + JSX in `app/**` and `lib/**`
 * - permit the `<a>` and `<img>` rules that `eslint-config-next` would
 *   normally enforce — kept light here because we don't import
 *   `eslint-config-next` into the flat-config (it's still a `.eslintrc`
 *   style preset). When T07 lands Tailwind + components we can revisit.
 */
export default [
  ...siteopsConfig,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // `console.warn` / `console.error` are allowed by the shared config;
      // we additionally permit `console.log` in server actions during dev
      // because pino isn't always wired in client-side helpers. Override
      // here so the rule stays strict everywhere else in the monorepo.
      'no-console': 'off',
    },
  },
  {
    // Next.js generates this file; never lint or modify it.
    ignores: ['.next/**', 'next-env.d.ts', 'public/tracker.js'],
  },
];
