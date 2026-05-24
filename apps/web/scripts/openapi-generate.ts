/**
 * Regenerate `docs/openapi.json` from the runtime registry.
 *
 * Usage (from repo root or apps/web):
 *   pnpm --filter @siteops/web openapi:generate
 *
 * Output is deterministic — keys sorted by the underlying generator, values
 * pretty-printed with a trailing newline so the file plays nicely with
 * editors and Prettier.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOpenApiDocument } from '../lib/openapi/build';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../../');
const target = resolve(repoRoot, 'docs/openapi.json');

const doc = buildOpenApiDocument();
const json = `${JSON.stringify(doc, null, 2)}\n`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, json, 'utf8');

const operationCount = Object.values(doc.paths ?? {}).reduce(
  (acc, ops) =>
    acc + Object.keys(ops ?? {}).filter((k) => !k.startsWith('x-') && k !== 'parameters').length,
  0,
);

console.log(`wrote ${target}`);

console.log(`  paths: ${Object.keys(doc.paths ?? {}).length}`);

console.log(`  operations: ${operationCount}`);
