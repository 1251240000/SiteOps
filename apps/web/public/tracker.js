(function (f) {
  'use strict';
  function h(e, t) {
    if (!e) return null;
    if (e instanceof Map) return e.get(t) ?? null;
    try {
      return e.getItem(t);
    } catch {
      return null;
    }
  }
  function S(e, t, n) {
    if (e)
      try {
        e instanceof Map ? e.set(t, n) : e.setItem(t, n);
      } catch {}
  }
  function E() {
    const e = globalThis.crypto;
    return e?.randomUUID
      ? e.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  }
  function A(e, t) {
    const n = JSON.stringify(e),
      r = globalThis.navigator;
    return r?.sendBeacon && r.sendBeacon(t, new Blob([n], { type: 'application/json' }))
      ? Promise.resolve()
      : fetch(t, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: n,
          keepalive: !0,
        }).then(() => {});
  }
  function I(e) {
    const t = new URLSearchParams(e),
      n = {};
    for (const r of ['source', 'medium', 'campaign', 'term', 'content']) {
      const s = t.get(`utm_${r}`);
      s && (n[r] = s);
    }
    return n;
  }
  function R(e) {
    return new TextEncoder().encode(JSON.stringify(e ?? {})).byteLength;
  }
  function M(e, t) {
    const n = {};
    return (
      e?.language && (n.language = e.language),
      e?.userAgent && (n.userAgent = e.userAgent),
      t && (n.screen = { width: t.width, height: t.height }),
      n
    );
  }
  function P(e) {
    const t = e.sampleRate ?? 1,
      n = t >= 1 || Math.random() <= t,
      r = Math.min(e.batchSize ?? 10, 50),
      s = e.idFactory ?? E,
      b = e.storage ?? globalThis.localStorage,
      _ = e.sessionStorage ?? globalThis.sessionStorage,
      a = e.location ?? globalThis.location,
      v = e.document ?? globalThis.document,
      k = e.navigator ?? globalThis.navigator,
      L = e.screen ?? globalThis.screen,
      U = e.transport ?? A,
      o = [];
    let u = h(b, 'siteops:visitor_id'),
      d = h(_, 'siteops:session_id');
    (u || ((u = `v_${s()}`), S(b, 'siteops:visitor_id', u)),
      d || ((d = `s_${s()}`), S(_, 'siteops:session_id', d)));
    function g(i) {
      if (n) {
        if (R(i.properties) > 8192) {
          e.debug && console.warn('[siteops-tracker] dropping oversized event properties', i.name);
          return;
        }
        o.length >= 50 || (o.push(i), o.length >= r && c.flush());
      }
    }
    const c = {
      track(i, l = {}) {
        g({ type: 'event', name: i, ts: new Date().toISOString(), properties: l });
      },
      identify(i, l = {}) {
        g({
          type: 'identify',
          name: 'identify',
          ts: new Date().toISOString(),
          properties: { userId: i, ...l },
        });
      },
      pageview(i, l = {}) {
        const y = a ? I(a.search) : {},
          w = M(k, L);
        g({
          type: 'pageview',
          name: 'pageview',
          ts: new Date().toISOString(),
          path: i ?? a?.pathname,
          url: a?.href,
          referrer: v?.referrer,
          properties: {
            title: v?.title,
            ...(Object.keys(y).length ? { utm: y } : {}),
            ...(Object.keys(w).length ? { device: w } : {}),
            ...l,
          },
        });
      },
      async flush() {
        if (o.length === 0) return;
        const i = o.splice(0, 50);
        await U(
          {
            siteKey: e.siteKey,
            sentAt: new Date().toISOString(),
            visitorId: u,
            sessionId: d,
            events: i,
          },
          e.endpoint,
        );
      },
    };
    return (
      (e.autoPageview ?? !0) && c.pageview(),
      (e.autoWebVitals ?? !0) &&
        e.webVitalsReporter?.((i) => {
          g({
            type: 'web_vital',
            name: i.name,
            ts: new Date().toISOString(),
            path: a?.pathname,
            url: a?.href,
            properties: {
              value: i.value,
              ...(i.rating ? { rating: i.rating } : {}),
              ...(i.id ? { id: i.id } : {}),
            },
          });
        }),
      e.flushIntervalMs !== 0 &&
        setInterval(() => {
          c.flush();
        }, e.flushIntervalMs ?? 5e3).unref?.(),
      globalThis.document?.addEventListener &&
        globalThis.document.addEventListener('visibilitychange', () => {
          globalThis.document.visibilityState === 'hidden' && c.flush();
        }),
      c
    );
  }
  function p(e, t) {
    return e === void 0 ? t : e === 'true' || e === '1';
  }
  function O(e, t) {
    const n = Number(e);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : t;
  }
  function m(e = globalThis.document?.currentScript) {
    if (!e) return (console.warn('[siteops-tracker] missing script element'), null);
    const t = e.dataset.siteKey?.trim();
    if (!t) return (console.warn('[siteops-tracker] missing data-site-key'), null);
    const n = e.dataset.endpoint ?? new URL('/api/v1/collect', e.src).toString();
    return P({
      siteKey: t,
      endpoint: n,
      autoPageview: p(e.dataset.autoPageview, !0),
      sampleRate: O(e.dataset.sampleRate, 1),
      debug: p(e.dataset.debug, !1),
    });
  }
  const T = m();
  (T && globalThis.window && (globalThis.window.SiteOpsTracker = T),
    (f.bootFromScript = m),
    Object.defineProperty(f, Symbol.toStringTag, { value: 'Module' }));
})((this.SiteOpsTracker = this.SiteOpsTracker || {}));
