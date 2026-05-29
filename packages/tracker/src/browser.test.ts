import { describe, expect, it, vi } from 'vitest';

vi.mock('./index.js', () => ({
  createTracker: vi.fn((options) => ({
    options,
    track: vi.fn(),
    identify: vi.fn(),
    pageview: vi.fn(),
    flush: vi.fn(),
  })),
}));

const { createTracker } = await import('./index.js');
const { bootFromScript } = await import('./browser.js');

function scriptWithDataset(src: string, dataset: Record<string, string>): HTMLScriptElement {
  return { src, dataset } as unknown as HTMLScriptElement;
}

describe('browser bootstrap', () => {
  it('reads data attributes and derives the default collect endpoint from script src', () => {
    const tracker = bootFromScript(
      scriptWithDataset('https://ops.example.com/tracker.js', {
        siteKey: 'site_pk_abc',
        autoPageview: 'false',
        sampleRate: '0.25',
        debug: 'true',
      }),
    );

    expect(tracker).not.toBeNull();
    expect(createTracker).toHaveBeenCalledWith(
      expect.objectContaining({
        siteKey: 'site_pk_abc',
        endpoint: 'https://ops.example.com/api/v1/collect',
        autoPageview: false,
        sampleRate: 0.25,
        debug: true,
      }),
    );
  });

  it('uses data-endpoint override and falls back invalid sample rate to 1', () => {
    bootFromScript(
      scriptWithDataset('https://ops.example.com/assets/tracker.js', {
        siteKey: 'site_pk_xyz',
        endpoint: 'https://collector.example.net/api/collect',
        sampleRate: '9',
      }),
    );

    expect(createTracker).toHaveBeenLastCalledWith(
      expect.objectContaining({
        siteKey: 'site_pk_xyz',
        endpoint: 'https://collector.example.net/api/collect',
        autoPageview: true,
        sampleRate: 1,
        debug: false,
      }),
    );
  });

  it('does not create a tracker when data-site-key is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const tracker = bootFromScript(scriptWithDataset('https://ops.example.com/tracker.js', {}));

    expect(tracker).toBeNull();
    expect(createTracker).not.toHaveBeenCalledWith(expect.objectContaining({ siteKey: '' }));
    expect(warn).toHaveBeenCalledWith('[siteops-tracker] missing data-site-key');
    warn.mockRestore();
  });
});
