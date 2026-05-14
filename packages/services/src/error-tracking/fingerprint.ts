/**
 * Error fingerprint.
 *
 * SHA-256 of `source + level + message + simplifiedStack`.
 * "Simplified stack" strips per-line column / line numbers and `at`/`from`
 * preambles so that two crashes in the same function at slightly different
 * lines hash to the same bucket. The bookkeeping is otherwise minimal:
 *   - lowercase
 *   - keep file paths / function names so different call sites stay distinct
 *   - cap to the first 30 frames (most stacks have a 1–2 frame "tail" of
 *     framework noise that's irrelevant)
 */
import { createHash } from 'node:crypto';

const FRAME_NUMBERS_RE = /:\d+(?::\d+)?\)?$/gm;
const FRAME_NUMBERS_NO_PAREN_RE = /:\d+(?::\d+)?$/gm;
const QUERY_RE = /\?[^\s:]+/g;
const HASH_RE = /#[^\s:]+/g;
const HEX_OBJECT_RE = /(?:0x)?[0-9a-f]{16,}/gi;

export function simplifyStack(stack: string | null | undefined): string {
  if (!stack) return '';
  const lines = stack.split(/\r?\n/);
  const trimmed: string[] = [];
  for (const raw of lines.slice(0, 30)) {
    let line = raw.trim();
    if (!line) continue;
    line = line.replace(FRAME_NUMBERS_RE, '').replace(FRAME_NUMBERS_NO_PAREN_RE, '');
    line = line.replace(QUERY_RE, '').replace(HASH_RE, '');
    line = line.replace(HEX_OBJECT_RE, 'HEX');
    trimmed.push(line);
  }
  return trimmed.join('\n').toLowerCase();
}

export function fingerprint(input: {
  source: string;
  level: string;
  message: string;
  stack?: string | null;
}): string {
  const message = input.message.trim().toLowerCase();
  const sig = `${input.source}|${input.level}|${message}|${simplifyStack(input.stack)}`;
  return createHash('sha256').update(sig).digest('hex');
}
