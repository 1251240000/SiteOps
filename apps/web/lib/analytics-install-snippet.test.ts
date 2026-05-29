import { describe, expect, it } from 'vitest';

import { buildAnalyticsInstallSnippet, getTrackerScriptUrl } from './analytics-install-snippet.js';

describe('analytics install snippet', () => {
  it('uses the public analytics key instead of the internal site id', () => {
    const snippet = buildAnalyticsInstallSnippet({
      appOrigin: 'https://ops.example.com',
      publicAnalyticsKey: 'site_pk_public',
      siteId: 'internal-site-id',
    });

    expect(snippet).toContain('src="https://ops.example.com/tracker.js"');
    expect(snippet).toContain('data-site-key="site_pk_public"');
    expect(snippet).not.toContain('internal-site-id');
  });

  it('normalizes trailing slashes when deriving tracker script url', () => {
    expect(getTrackerScriptUrl('https://ops.example.com/')).toBe(
      'https://ops.example.com/tracker.js',
    );
  });
});
