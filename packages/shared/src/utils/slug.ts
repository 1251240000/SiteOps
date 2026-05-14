/**
 * Slug helpers shared between the API and the dashboard.
 *
 * The site registry generates slugs from human-entered names; the
 * canonicalisation rules:
 *  - lowercase
 *  - non-alphanumeric → "-"
 *  - collapse consecutive dashes
 *  - trim leading/trailing dashes
 *  - cap at 64 chars (matches `slugSchema`)
 *
 * Unicode characters are stripped (Latin lowercase/digits only) because the
 * slug is used both as a URL segment and as a CSS / log identifier — keeping
 * the alphabet small avoids surprises.
 */

const MAX_LEN = 64;

export function slugify(input: string): string {
  const ascii = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics
    .toLowerCase();
  const cleaned = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned.length === 0) return 'site';
  return cleaned.slice(0, MAX_LEN).replace(/-+$/, '') || 'site';
}

/**
 * Given a candidate slug and the set of slugs already taken, return a
 * conflict-free variant by appending `-2`, `-3`, … Stops at `attempts`
 * to keep this deterministic in tests; callers should treat failure as a
 * "pick a different name" prompt.
 */
export function nextAvailableSlug(base: string, taken: Iterable<string>, attempts = 50): string {
  const takenSet = new Set(taken);
  if (!takenSet.has(base)) return base;
  for (let i = 2; i < 2 + attempts; i++) {
    const candidate = `${base}-${i}`;
    if (!takenSet.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a free slug after ${attempts} attempts (base=${base})`);
}
