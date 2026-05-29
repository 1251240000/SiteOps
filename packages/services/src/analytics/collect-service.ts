import { createHash } from 'node:crypto';

import { analyticsRepo, type Db } from '@siteops/db';
import { AppError, collectPayloadSchema, type CollectPayload } from '@siteops/shared';

export type CollectResult = { accepted: number; siteId: string };

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
    .join(',')}}`;
}

function eventHash(siteId: string, payload: CollectPayload, index: number): string {
  const event = payload.events[index];
  return createHash('sha256')
    .update(siteId)
    .update('\0')
    .update(payload.visitorId)
    .update('\0')
    .update(payload.sessionId)
    .update('\0')
    .update(stableJson(event))
    .digest('hex');
}

export function allowedOrigin(primaryUrl: string, origin: string | null): boolean {
  if (!origin) return true;
  try {
    const registered = new URL(primaryUrl).hostname.toLowerCase();
    const incoming = new URL(origin).hostname.toLowerCase();
    return incoming === registered || incoming.endsWith(`.${registered}`);
  } catch {
    return false;
  }
}

export const analyticsCollectService = {
  async collect(db: Db, raw: unknown, origin: string | null = null): Promise<CollectResult> {
    const parsed = collectPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('Invalid collect payload', {
        code: 'validation_failed',
        status: 400,
        details: parsed.error.flatten(),
      });
    }
    const payload = parsed.data;
    const site = await analyticsRepo.findSiteByPublicKey(db, payload.siteKey);
    if (!site) throw new AppError('Invalid site key', { code: 'invalid_site_key', status: 401 });
    if (!allowedOrigin(site.primaryUrl, origin)) {
      throw new AppError('Origin is not allowed for this site', {
        code: 'origin_forbidden',
        status: 403,
      });
    }

    const seenAt = new Date(payload.sentAt);
    const first = payload.events[0];
    await analyticsRepo.upsertSession(db, {
      siteId: site.id,
      visitorId: payload.visitorId,
      sessionId: payload.sessionId,
      seenAt,
      referrer: first?.referrer ?? null,
      utm:
        first?.properties && typeof first.properties === 'object' && 'utm' in first.properties
          ? (first.properties.utm as Record<string, unknown>)
          : null,
      device:
        first?.properties && typeof first.properties === 'object' && 'device' in first.properties
          ? (first.properties.device as Record<string, unknown>)
          : null,
    });

    const events = payload.events.map((event, index) => ({
      siteId: site.id,
      visitorId: payload.visitorId,
      sessionId: payload.sessionId,
      type: event.type,
      name: event.name,
      path: event.path ?? null,
      url: event.url ?? null,
      referrer: event.referrer ?? null,
      properties: event.properties ?? {},
      eventHash: eventHash(site.id, payload, index),
      occurredAt: new Date(event.ts),
    }));
    const accepted = await analyticsRepo.insertEvents(db, events);
    return { accepted, siteId: site.id };
  },
};
