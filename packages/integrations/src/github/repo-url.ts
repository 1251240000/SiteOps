/**
 * Parse a "repo URL" supplied by a human into the canonical `{ owner, repo }`
 * pair used by the GitHub REST API.
 *
 * Accepted shapes (lower-cased after parsing):
 *   - `https://github.com/owner/repo`
 *   - `https://github.com/owner/repo.git`
 *   - `https://github.com/owner/repo/`
 *   - `git@github.com:owner/repo.git`
 *   - `ssh://git@github.com/owner/repo.git`
 *   - `owner/repo`
 *   - `github:owner/repo`
 *
 * Returns `null` when the input is not parseable. Repository names cannot
 * contain slashes; sub-paths inside a repo are deliberately ignored.
 */

export type ParsedRepoUrl = { owner: string; repo: string };

const SLUG_RE = /^[a-z0-9_.-]+$/i;

function stripGitSuffix(s: string): string {
  return s.replace(/\.git$/i, '');
}

export function parseRepoUrl(input: string | null | undefined): ParsedRepoUrl | null {
  if (!input) return null;
  let raw = String(input).trim();
  if (!raw) return null;

  // `github:owner/repo` shorthand.
  if (raw.startsWith('github:')) raw = raw.slice('github:'.length);

  // `owner/repo` (no scheme, no host).
  if (!raw.includes('://') && !raw.startsWith('git@') && !raw.includes(' ')) {
    if (raw.split('/').filter(Boolean).length === 2) {
      const [owner, repo] = raw.split('/');
      if (owner && repo) {
        const r = stripGitSuffix(repo);
        if (SLUG_RE.test(owner) && SLUG_RE.test(r)) return { owner, repo: r };
      }
    }
  }

  // `git@github.com:owner/repo.git`
  if (raw.startsWith('git@')) {
    const m = /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(raw);
    if (m) {
      const host = m[1]?.toLowerCase();
      const owner = m[2];
      const repo = m[3];
      if (host === 'github.com' && owner && repo && SLUG_RE.test(owner) && SLUG_RE.test(repo)) {
        return { owner, repo };
      }
    }
    return null;
  }

  // URL-shaped — try the URL parser, falling back gracefully.
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const ownerPart = parts[0];
    const repoPart = parts[1];
    if (!ownerPart || !repoPart) return null;
    const owner = ownerPart;
    const repo = stripGitSuffix(repoPart);
    if (!SLUG_RE.test(owner) || !SLUG_RE.test(repo)) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}
