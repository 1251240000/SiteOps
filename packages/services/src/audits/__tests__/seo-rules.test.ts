import { describe, expect, it } from 'vitest';

import { runSeoRules, scoreFindings, summarise, type SeoAuditInput } from '../seo-rules.js';

function pageInput(html: string, url = 'https://example.com/'): SeoAuditInput['homepage'] {
  return { url, status: 200, html };
}

function input(html: string): SeoAuditInput {
  return {
    homepage: pageInput(html),
    robots: {
      fetched: true,
      status: 200,
      text: 'User-agent: *\nAllow: /\n',
    },
    sitemap: {
      attempts: [
        {
          url: 'https://example.com/sitemap.xml',
          status: 200,
          ok: true,
          xml: '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
        },
      ],
    },
  };
}

describe('runSeoRules', () => {
  it('flags missing title / description / h1 / canonical / og:image', () => {
    const findings = runSeoRules(input('<html><body><p>hi</p></body></html>'));
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('seo.missing_title');
    expect(codes).toContain('seo.missing_meta_description');
    expect(codes).toContain('seo.no_h1');
    expect(codes).toContain('seo.missing_canonical');
    expect(codes).toContain('seo.missing_og_image');
  });

  it('passes a complete page with no warnings', () => {
    const html = `<!doctype html><html lang="en"><head>
      <title>${'A solid SEO title for a content-rich page that is well sized'.slice(0, 55)}</title>
      <meta name="description" content="${'A perfectly sized description that explains what this page is all about and helps with snippet rendering across SERPs.'}">
      <link rel="canonical" href="https://example.com/">
      <meta property="og:image" content="https://example.com/og.png">
    </head><body><h1>Welcome</h1></body></html>`;
    const findings = runSeoRules(input(html));
    expect(findings.filter((f) => f.severity !== 'info')).toHaveLength(0);
  });

  it('flags too-long title and too-short description', () => {
    const html =
      '<html><head>' +
      '<title>x</title>' +
      '<meta name="description" content="short">' +
      '<link rel="canonical" href="https://example.com/">' +
      '<meta property="og:image" content="https://example.com/og.png">' +
      '</head><body><h1>x</h1></body></html>';
    const findings = runSeoRules(input(html));
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('seo.title_too_long');
    expect(codes).toContain('seo.meta_description_too_long');
  });

  it('flags robots Disallow /', () => {
    const i = input(
      '<html><head><title>title-30chars-min-foobar-baz</title></head><body><h1>x</h1></body></html>',
    );
    i.robots = { fetched: true, status: 200, text: 'User-agent: *\nDisallow: /\n' };
    const findings = runSeoRules(i);
    expect(findings.some((f) => f.code === 'seo.robots_disallow_root')).toBe(true);
  });

  it('flags missing sitemap', () => {
    const i = input(
      '<html><head><title>title-30chars-min-foobar-baz</title></head><body><h1>x</h1></body></html>',
    );
    i.sitemap = { attempts: [] };
    const findings = runSeoRules(i);
    expect(findings.some((f) => f.code === 'seo.sitemap_missing')).toBe(true);
  });

  it('flags multiple h1', () => {
    const html = '<html><body><h1>a</h1><h1>b</h1></body></html>';
    const findings = runSeoRules(input(html));
    expect(findings.some((f) => f.code === 'seo.multiple_h1')).toBe(true);
  });

  it('flags structured-data parse failures', () => {
    const html =
      '<html><head><script type="application/ld+json">{not valid json}</script></head><body><h1>x</h1></body></html>';
    const findings = runSeoRules(input(html));
    expect(findings.some((f) => f.code === 'seo.structured_data_invalid')).toBe(true);
  });

  it('returns a single fetch_failed finding when html is empty', () => {
    const i: SeoAuditInput = {
      homepage: { url: 'https://x.example/', status: 0, html: '' },
      robots: { fetched: false, status: null, text: '' },
      sitemap: { attempts: [] },
    };
    const findings = runSeoRules(i);
    expect(findings.find((f) => f.code === 'seo.fetch_failed')).toBeDefined();
  });
});

describe('scoreFindings + summarise', () => {
  it('penalises higher severities more', () => {
    const high = scoreFindings([
      { code: 'a', severity: 'critical', title: 'a' },
      { code: 'b', severity: 'critical', title: 'b' },
    ]);
    const low = scoreFindings([
      { code: 'a', severity: 'info', title: 'a' },
      { code: 'b', severity: 'info', title: 'b' },
    ]);
    expect(low).toBeGreaterThan(high);
  });

  it('summarise groups by code and severity', () => {
    const s = summarise([
      { code: 'seo.no_h1', severity: 'error', title: 'a' },
      { code: 'seo.no_h1', severity: 'error', title: 'b' },
      { code: 'seo.missing_og_image', severity: 'warning', title: 'c' },
    ]);
    expect(s.total).toBe(3);
    expect(s.byCode['seo.no_h1']).toBe(2);
    expect(s.bySeverity.error).toBe(2);
    expect(s.bySeverity.warning).toBe(1);
    expect(s.score).toBeLessThan(100);
  });
});
