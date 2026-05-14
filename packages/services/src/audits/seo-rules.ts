/**
 * SEO rule set.
 *
 * Pure functions over parsed HTML / sitemap / robots data. Each rule maps
 * one or more inputs to zero-or-more `RuleFinding` records. The audit
 * service composes them and persists the result.
 *
 * Severity convention:
 *   - `critical` blocks indexing entirely (e.g. robots disallow /)
 *   - `error`    breaks a major SEO surface (missing title, sitemap invalid)
 *   - `warning`  degrades quality (length issues, missing OG image)
 *   - `info`     informational (e.g. structured-data parse failure)
 */
import { load, type CheerioAPI } from 'cheerio';

import type { FindingSeverity } from '@siteops/db';

export type RuleFinding = {
  code: string;
  severity: FindingSeverity;
  title: string;
  message?: string;
  url?: string;
  meta?: Record<string, unknown>;
};

export type SeoPageInput = {
  /** Final URL after redirects. */
  url: string;
  /** HTTP status. */
  status: number;
  /** Decoded HTML body (possibly truncated). */
  html: string;
};

export type SeoRobotsInput = {
  /** True when `/robots.txt` returned 2xx. */
  fetched: boolean;
  status: number | null;
  text: string;
};

export type SeoSitemapInput = {
  /** Tried URLs (sitemap.xml + sitemap_index.xml) in order. */
  attempts: Array<{ url: string; status: number | null; ok: boolean; xml: string }>;
};

export type SeoAuditInput = {
  homepage: SeoPageInput;
  robots: SeoRobotsInput;
  sitemap: SeoSitemapInput;
};

const TITLE_MIN = 30;
const TITLE_MAX = 60;
const DESC_MIN = 50;
const DESC_MAX = 160;

function txt($: CheerioAPI, sel: string): string {
  return $(sel).first().text().trim();
}

function attr($: CheerioAPI, sel: string, name: string): string | undefined {
  const v = $(sel).first().attr(name);
  return typeof v === 'string' ? v.trim() : undefined;
}

export function checkTitle($: CheerioAPI): RuleFinding[] {
  const t = txt($, 'head > title');
  if (!t) {
    return [
      {
        code: 'seo.missing_title',
        severity: 'error',
        title: 'Missing <title>',
        message: 'The page has no <title> element.',
      },
    ];
  }
  if (t.length < TITLE_MIN || t.length > TITLE_MAX) {
    return [
      {
        code: 'seo.title_too_long',
        severity: 'warning',
        title: 'Title length out of range',
        message: `Title is ${t.length} chars; recommended ${TITLE_MIN}–${TITLE_MAX}.`,
        meta: { length: t.length },
      },
    ];
  }
  return [];
}

export function checkMetaDescription($: CheerioAPI): RuleFinding[] {
  const desc = attr($, 'meta[name="description"]', 'content');
  if (!desc) {
    return [
      {
        code: 'seo.missing_meta_description',
        severity: 'error',
        title: 'Missing meta description',
      },
    ];
  }
  if (desc.length < DESC_MIN || desc.length > DESC_MAX) {
    return [
      {
        code: 'seo.meta_description_too_long',
        severity: 'warning',
        title: 'Meta description length out of range',
        message: `Description is ${desc.length} chars; recommended ${DESC_MIN}–${DESC_MAX}.`,
        meta: { length: desc.length },
      },
    ];
  }
  return [];
}

export function checkCanonical(input: SeoPageInput, $: CheerioAPI): RuleFinding[] {
  const canonical = attr($, 'link[rel="canonical"]', 'href');
  if (!canonical) {
    return [
      {
        code: 'seo.missing_canonical',
        severity: 'warning',
        title: 'Missing canonical link',
      },
    ];
  }
  try {
    const c = new URL(canonical, input.url);
    const page = new URL(input.url);
    if (c.origin !== page.origin) {
      return [
        {
          code: 'seo.canonical_mismatch',
          severity: 'warning',
          title: 'Canonical points to a different origin',
          meta: { canonical: c.toString(), pageOrigin: page.origin },
        },
      ];
    }
  } catch {
    return [
      {
        code: 'seo.canonical_mismatch',
        severity: 'warning',
        title: 'Canonical is not a valid URL',
        meta: { canonical },
      },
    ];
  }
  return [];
}

export function checkOg($: CheerioAPI): RuleFinding[] {
  const ogImage = attr($, 'meta[property="og:image"]', 'content');
  if (!ogImage) {
    return [
      {
        code: 'seo.missing_og_image',
        severity: 'warning',
        title: 'Missing og:image',
      },
    ];
  }
  return [];
}

export function checkH1($: CheerioAPI): RuleFinding[] {
  const h1Count = $('h1').length;
  if (h1Count === 0) {
    return [{ code: 'seo.no_h1', severity: 'error', title: 'No <h1> on page' }];
  }
  if (h1Count > 1) {
    return [
      {
        code: 'seo.multiple_h1',
        severity: 'warning',
        title: `Page has ${h1Count} <h1> elements`,
        meta: { count: h1Count },
      },
    ];
  }
  return [];
}

export function checkRobots(robots: SeoRobotsInput): RuleFinding[] {
  if (!robots.fetched) {
    return [
      {
        code: 'seo.robots_missing',
        severity: 'warning',
        title: '/robots.txt not found',
      },
    ];
  }
  // Crude parse: only look at the `User-agent: *` block.
  const lines = robots.text.split(/\r?\n/);
  let inStar = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      inStar = value === '*';
      continue;
    }
    if (inStar && key === 'disallow' && (value === '/' || value === '*')) {
      return [
        {
          code: 'seo.robots_disallow_root',
          severity: 'critical',
          title: 'robots.txt blocks the entire site',
          meta: { rule: line },
        },
      ];
    }
  }
  return [];
}

export function checkSitemap(sitemap: SeoSitemapInput): RuleFinding[] {
  const successful = sitemap.attempts.find((a) => a.ok && a.xml.length > 0);
  if (!successful) {
    return [
      {
        code: 'seo.sitemap_missing',
        severity: 'error',
        title: 'sitemap.xml not found',
        meta: { tried: sitemap.attempts.map((a) => a.url) },
      },
    ];
  }
  if (!/<\?xml\b/.test(successful.xml) || !/<(urlset|sitemapindex)\b/.test(successful.xml)) {
    return [
      {
        code: 'seo.sitemap_invalid',
        severity: 'error',
        title: 'sitemap.xml parse failed',
        message: 'Not recognised as urlset or sitemapindex.',
        meta: { url: successful.url },
      },
    ];
  }
  return [];
}

export function checkHreflang(input: SeoPageInput, $: CheerioAPI): RuleFinding[] {
  void input; // reserved for future per-URL hreflang correctness checks
  const htmlLang = attr($, 'html', 'lang');
  const hreflangs = $('link[rel="alternate"][hreflang]');
  if (hreflangs.length === 0) return [];
  if (!htmlLang) return [];
  const langs = new Set<string>();
  hreflangs.each((_i, el) => {
    const v = ($(el).attr('hreflang') ?? '').toLowerCase();
    if (v.length > 0) langs.add(v);
  });
  if (!langs.has(htmlLang.toLowerCase()) && !langs.has(htmlLang.split('-')[0]!.toLowerCase())) {
    return [
      {
        code: 'seo.hreflang_mismatch',
        severity: 'warning',
        title: 'Declared <html lang> not in hreflang set',
        meta: { htmlLang, langs: [...langs] },
      },
    ];
  }
  return [];
}

export function checkStructuredData($: CheerioAPI): RuleFinding[] {
  const findings: RuleFinding[] = [];
  $('script[type="application/ld+json"]').each((_i, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      JSON.parse(raw);
    } catch (err) {
      findings.push({
        code: 'seo.structured_data_invalid',
        severity: 'info',
        title: 'JSON-LD script could not be parsed',
        meta: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  });
  return findings;
}

/** Run every rule against the captured inputs. */
export function runSeoRules(input: SeoAuditInput): RuleFinding[] {
  if (!input.homepage.html) {
    return [
      {
        code: 'seo.fetch_failed',
        severity: 'error',
        title: 'Homepage fetch failed',
        meta: { status: input.homepage.status, url: input.homepage.url },
      },
    ];
  }
  const $ = load(input.homepage.html);
  return [
    ...checkTitle($),
    ...checkMetaDescription($),
    ...checkCanonical(input.homepage, $),
    ...checkOg($),
    ...checkH1($),
    ...checkHreflang(input.homepage, $),
    ...checkStructuredData($),
    ...checkRobots(input.robots),
    ...checkSitemap(input.sitemap),
  ];
}

const SEVERITY_PENALTY: Record<FindingSeverity, number> = {
  info: 1,
  warning: 5,
  error: 12,
  critical: 30,
};

/** 0–100 score (deduction-based) from a finding list. */
export function scoreFindings(findings: ReadonlyArray<RuleFinding>): number {
  let score = 100;
  for (const f of findings) score -= SEVERITY_PENALTY[f.severity];
  return Math.max(0, Math.min(100, score));
}

export type SeoSummary = {
  total: number;
  byCode: Record<string, number>;
  bySeverity: Record<FindingSeverity, number>;
  score: number;
};

export function summarise(findings: ReadonlyArray<RuleFinding>): SeoSummary {
  const byCode: Record<string, number> = {};
  const bySeverity: Record<FindingSeverity, number> = {
    info: 0,
    warning: 0,
    error: 0,
    critical: 0,
  };
  for (const f of findings) {
    byCode[f.code] = (byCode[f.code] ?? 0) + 1;
    bySeverity[f.severity] += 1;
  }
  return {
    total: findings.length,
    byCode,
    bySeverity,
    score: scoreFindings(findings),
  };
}

export { SEVERITY_PENALTY };
