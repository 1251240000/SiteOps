/**
 * Canonical webhook provider list — kept in lock-step with the DB CHECK
 * constraint on `webhook_events.provider` via the constants-drift test.
 *
 * Adding a provider here is a three-step dance:
 *   1. add to this array
 *   2. add a `dispatch<Foo>` arm in `webhook-service`
 *   3. add a route under `apps/web/app/api/v1/hooks/<foo>/route.ts`
 */
export const WEBHOOK_PROVIDERS = ['cloudflare', 'github'] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

/**
 * Anti-spam threshold for `signature_ok=false` rows: when the same
 * `(provider, source_ip)` has flooded more than this many invalid
 * deliveries in a 5-minute window, subsequent invalid hits short-circuit
 * to 401 *without* writing a row. Lives in `webhookService` as a singleton
 * counter so multiple route invocations share the bucket.
 */
export const WEBHOOK_BAD_SIG_WINDOW_MS = 5 * 60 * 1000;
export const WEBHOOK_BAD_SIG_WINDOW_MAX = 50;

/** Hard retention — applied by housekeeping in a future task; left for T27.5+. */
export const WEBHOOK_EVENT_RETENTION_DAYS = 90;
