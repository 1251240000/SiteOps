/**
 * Process-cached AlertCipher used by API routes. The cipher key falls back
 * to a dev-only placeholder when not configured so local dev works without
 * extra env wiring; production must set ALERT_CIPHER_KEY.
 */
import { alerts as alertsSvc } from '@siteops/services';

import { getEnv } from './env';

let cached: alertsSvc.AlertCipher | undefined;

const DEV_FALLBACK = 'dev-only-cipher-key-do-not-use-in-prod';

export function getAlertCipher(): alertsSvc.AlertCipher {
  if (cached) return cached;
  const env = getEnv();
  const key = (process.env['ALERT_CIPHER_KEY'] ?? '').trim();
  if (env.NODE_ENV === 'production' && !key) {
    throw new Error('ALERT_CIPHER_KEY required in production');
  }
  cached = new alertsSvc.AlertCipher(key || DEV_FALLBACK);
  return cached;
}
