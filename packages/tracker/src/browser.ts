import { createTracker, type Tracker } from './index.js';

export type SiteOpsTrackerGlobal = Tracker;

declare global {
  interface Window {
    SiteOpsTracker?: SiteOpsTrackerGlobal;
  }
}

function boolAttr(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function numberAttr(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

export function bootFromScript(
  script: HTMLScriptElement | null = globalThis.document?.currentScript as HTMLScriptElement | null,
): Tracker | null {
  if (!script) {
    console.warn('[siteops-tracker] missing script element');
    return null;
  }

  const siteKey = script.dataset.siteKey?.trim();
  if (!siteKey) {
    console.warn('[siteops-tracker] missing data-site-key');
    return null;
  }

  const endpoint = script.dataset.endpoint ?? new URL('/api/v1/collect', script.src).toString();
  return createTracker({
    siteKey,
    endpoint,
    autoPageview: boolAttr(script.dataset.autoPageview, true),
    sampleRate: numberAttr(script.dataset.sampleRate, 1),
    debug: boolAttr(script.dataset.debug, false),
  });
}

const tracker = bootFromScript();
if (tracker && globalThis.window) {
  globalThis.window.SiteOpsTracker = tracker;
}
