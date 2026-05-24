/**
 * CI guard: regenerate the OpenAPI document in-memory and compare against
 * the committed `docs/openapi.json`. Exits with status 1 when they drift
 * so PRs that change routes without regenerating the spec are blocked.
 *
 * Usage:
 *   pnpm --filter @siteops/web openapi:check
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOpenApiDocument } from '../lib/openapi/build';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../');
const target = resolve(repoRoot, 'docs/openapi.json');

const doc = buildOpenApiDocument();
const generated = `${JSON.stringify(doc, null, 2)}\n`;

let committed: string;
try {
  committed = readFileSync(target, 'utf8');
} catch (err) {
  console.error(
    `[openapi:check] could not read ${target}. ` +
      `Run \`pnpm --filter @siteops/web openapi:generate\` and commit the result.`,
  );

  console.error(err);
  process.exit(1);
}

if (generated === committed) {
  console.log(`[openapi:check] ok — ${target} matches the live registry.`);
  process.exit(0);
}

// Drift detected — show a compact diff hint so devs know what to do.

console.error(
  `[openapi:check] FAIL — generated spec differs from committed ${target}.\n` +
    `Run \`pnpm --filter @siteops/web openapi:generate\` and commit the diff.`,
);

// Print a small unified-ish diff of the first 40 differing lines so CI logs
// hint at what changed. We deliberately keep this compact — `git diff` is
// the authoritative source.
const a = committed.split('\n');
const b = generated.split('\n');
const max = Math.min(Math.max(a.length, b.length), 4000);
let shown = 0;
for (let i = 0; i < max && shown < 40; i += 1) {
  if (a[i] !== b[i]) {
    console.error(`- ${i + 1}: ${a[i] ?? ''}`);

    console.error(`+ ${i + 1}: ${b[i] ?? ''}`);
    shown += 1;
  }
}
process.exit(1);
