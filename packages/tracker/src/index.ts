export type AnalyticsEventType = 'pageview' | 'event' | 'web_vital' | 'identify';

export type TrackerEvent = {
  type: AnalyticsEventType;
  name: string;
  ts: string;
  path?: string;
  url?: string;
  referrer?: string;
  properties?: Record<string, unknown>;
};

export type CollectPayload = {
  siteKey: string;
  sentAt: string;
  visitorId: string;
  sessionId: string;
  events: TrackerEvent[];
};

export type TrackerTransport = (payload: CollectPayload, endpoint: string) => Promise<void>;

export type TrackerOptions = {
  siteKey: string;
  endpoint: string;
  autoPageview?: boolean;
  autoWebVitals?: boolean;
  sampleRate?: number;
  batchSize?: number;
  flushIntervalMs?: number;
  debug?: boolean;
  transport?: TrackerTransport;
  idFactory?: () => string;
  storage?: StorageLike;
  sessionStorage?: StorageLike;
  location?: LocationLike;
  document?: DocumentLike;
  navigator?: NavigatorLike;
  screen?: ScreenLike;
  webVitalsReporter?: WebVitalsReporter;
};

export type Tracker = {
  track(name: string, properties?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  pageview(path?: string, properties?: Record<string, unknown>): void;
  flush(): Promise<void>;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'> | Map<string, string>;
type LocationLike = Pick<Location, 'href' | 'pathname' | 'search'>;
type DocumentLike = Pick<Document, 'title' | 'referrer'>;
type NavigatorLike = Pick<Navigator, 'language' | 'sendBeacon' | 'userAgent'>;
type ScreenLike = Pick<Screen, 'width' | 'height'>;
export type WebVitalMetric = {
  name: 'LCP' | 'CLS' | 'INP' | 'FCP' | 'TTFB';
  value: number;
  rating?: 'good' | 'needs-improvement' | 'poor';
  id?: string;
};
export type WebVitalsReporter = (callback: (metric: WebVitalMetric) => void) => void | (() => void);

const MAX_PROPERTIES_BYTES = 8 * 1024;
const MAX_EVENTS_PER_BATCH = 50;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

function storageGet(storage: StorageLike | undefined, key: string): string | null {
  if (!storage) return null;
  if (storage instanceof Map) return storage.get(key) ?? null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage: StorageLike | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    if (storage instanceof Map) storage.set(key, value);
    else storage.setItem(key, value);
  } catch {
    // Storage may be disabled; memory fallback is handled by caller state.
  }
}

function defaultId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function defaultTransport(payload: CollectPayload, endpoint: string): Promise<void> {
  const body = JSON.stringify(payload);
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.sendBeacon) {
    const ok = nav.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    if (ok) return Promise.resolve();
  }
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).then(() => undefined);
}

function parseUtm(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const key of ['source', 'medium', 'campaign', 'term', 'content']) {
    const value = params.get(`utm_${key}`);
    if (value) out[key] = value;
  }
  return out;
}

function propertiesSize(properties: Record<string, unknown> | undefined): number {
  return new TextEncoder().encode(JSON.stringify(properties ?? {})).byteLength;
}

function deviceProperties(
  navigatorObj: NavigatorLike | undefined,
  screenObj: ScreenLike | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (navigatorObj?.language) out.language = navigatorObj.language;
  if (navigatorObj?.userAgent) out.userAgent = navigatorObj.userAgent;
  if (screenObj) out.screen = { width: screenObj.width, height: screenObj.height };
  return out;
}

export function createTracker(options: TrackerOptions): Tracker {
  const sampleRate = options.sampleRate ?? 1;
  const sampledIn = sampleRate >= 1 || Math.random() <= sampleRate;
  const batchSize = Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, MAX_EVENTS_PER_BATCH);
  const idFactory = options.idFactory ?? defaultId;
  const storage = options.storage ?? globalThis.localStorage;
  const sessionStorage = options.sessionStorage ?? globalThis.sessionStorage;
  const location = options.location ?? globalThis.location;
  const documentObj = options.document ?? globalThis.document;
  const navigatorObj = options.navigator ?? globalThis.navigator;
  const screenObj = options.screen ?? globalThis.screen;
  const transport = options.transport ?? defaultTransport;
  const queue: TrackerEvent[] = [];
  let visitorId = storageGet(storage, 'siteops:visitor_id');
  let sessionId = storageGet(sessionStorage, 'siteops:session_id');
  if (!visitorId) {
    visitorId = `v_${idFactory()}`;
    storageSet(storage, 'siteops:visitor_id', visitorId);
  }
  if (!sessionId) {
    sessionId = `s_${idFactory()}`;
    storageSet(sessionStorage, 'siteops:session_id', sessionId);
  }

  function enqueue(event: TrackerEvent): void {
    if (!sampledIn) return;
    if (propertiesSize(event.properties) > MAX_PROPERTIES_BYTES) {
      if (options.debug)
        console.warn('[siteops-tracker] dropping oversized event properties', event.name);
      return;
    }
    if (queue.length >= MAX_EVENTS_PER_BATCH) return;
    queue.push(event);
    if (queue.length >= batchSize) void api.flush();
  }

  const api: Tracker = {
    track(name, properties = {}) {
      enqueue({ type: 'event', name, ts: new Date().toISOString(), properties });
    },
    identify(userId, traits = {}) {
      enqueue({
        type: 'identify',
        name: 'identify',
        ts: new Date().toISOString(),
        properties: { userId, ...traits },
      });
    },
    pageview(path, properties = {}) {
      const utm = location ? parseUtm(location.search) : {};
      const device = deviceProperties(navigatorObj, screenObj);
      enqueue({
        type: 'pageview',
        name: 'pageview',
        ts: new Date().toISOString(),
        path: path ?? location?.pathname,
        url: location?.href,
        referrer: documentObj?.referrer,
        properties: {
          title: documentObj?.title,
          ...(Object.keys(utm).length ? { utm } : {}),
          ...(Object.keys(device).length ? { device } : {}),
          ...properties,
        },
      });
    },
    async flush() {
      if (queue.length === 0) return;
      const events = queue.splice(0, MAX_EVENTS_PER_BATCH);
      await transport(
        {
          siteKey: options.siteKey,
          sentAt: new Date().toISOString(),
          visitorId,
          sessionId,
          events,
        },
        options.endpoint,
      );
    },
  };

  if (options.autoPageview ?? true) api.pageview();
  if (options.autoWebVitals ?? true) {
    options.webVitalsReporter?.((metric) => {
      enqueue({
        type: 'web_vital',
        name: metric.name,
        ts: new Date().toISOString(),
        path: location?.pathname,
        url: location?.href,
        properties: {
          value: metric.value,
          ...(metric.rating ? { rating: metric.rating } : {}),
          ...(metric.id ? { id: metric.id } : {}),
        },
      });
    });
  }
  if (options.flushIntervalMs !== 0) {
    const timer = setInterval(
      () => void api.flush(),
      options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
    );
    (timer as { unref?: () => void }).unref?.();
  }
  if (globalThis.document?.addEventListener) {
    globalThis.document.addEventListener('visibilitychange', () => {
      if (globalThis.document.visibilityState === 'hidden') void api.flush();
    });
  }
  return api;
}
