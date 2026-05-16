#!/usr/bin/env node
/**
 * Verifies that every supported locale catalog exposes the same set of
 * (dot-flattened) keys. Used in CI to keep zh-CN and en-US strictly in
 * lock-step — adding / renaming / removing a key in one without touching
 * the other will fail the build.
 *
 * Usage: `pnpm -F @siteops/web i18n:check`
 *
 * Exit codes:
 *   0 — every locale has identical key set
 *   1 — at least one locale is missing or has extra keys (full diff printed)
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = resolve(HERE, '..', 'messages');

const LOCALES = ['zh-CN', 'en-US'];

function flatten(obj, prefix = '') {
  const out = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const k of flatten(value, path)) out.add(k);
    } else {
      out.add(path);
    }
  }
  return out;
}

async function loadKeys(locale) {
  const path = resolve(MESSAGES_DIR, `${locale}.json`);
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw);
  return flatten(parsed);
}

async function main() {
  const all = await Promise.all(LOCALES.map((l) => loadKeys(l).then((keys) => ({ l, keys }))));
  const baseline = all[0];
  let ok = true;

  for (const { l, keys } of all) {
    if (l === baseline.l) continue;
    const missing = [...baseline.keys].filter((k) => !keys.has(k)).sort();
    const extra = [...keys].filter((k) => !baseline.keys.has(k)).sort();
    if (missing.length > 0) {
      ok = false;
      console.error(`[i18n] ${l} is missing ${missing.length} keys present in ${baseline.l}:`);
      for (const k of missing) console.error(`  - ${k}`);
    }
    if (extra.length > 0) {
      ok = false;
      console.error(`[i18n] ${l} has ${extra.length} keys not in ${baseline.l}:`);
      for (const k of extra) console.error(`  + ${k}`);
    }
  }

  if (!ok) {
    console.error('\n[i18n] catalog parity check failed. Update both files in lockstep.');
    process.exit(1);
  }
  console.log(`[i18n] ok — ${baseline.keys.size} keys, locales: ${LOCALES.join(', ')}`);
}

main().catch((err) => {
  console.error('[i18n] check failed:', err);
  process.exit(1);
});
