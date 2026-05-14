/**
 * Credentials service.
 *
 * Encrypts an OAuth payload with the shared `AlertCipher`, stores it in the
 * `integration_credentials` table, and exposes a typed `read()` that decrypts
 * on demand. Used by GSC + AdSense.
 *
 * The cipher is injected so callers can share a single AES key with the
 * alerts module (`ALERT_CIPHER_KEY`).
 */

import { integrationCredentialRepo, type Db } from '@siteops/db';
import { AppError } from '@siteops/shared';

import type { AlertCipher } from '../alerts/cipher.js';

export type CredentialPayload = {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: string;
  scope?: string;
};

export type CredentialsServiceDeps = {
  db: Db;
  cipher: AlertCipher;
};

export const credentialsService = {
  async save(
    deps: CredentialsServiceDeps,
    provider: string,
    payload: CredentialPayload,
    opts: { scope?: string } = {},
  ): Promise<void> {
    if (!payload.refreshToken) {
      throw new AppError('Missing refreshToken', {
        code: 'validation_failed',
        status: 400,
      });
    }
    const encryptedPayload = deps.cipher.encryptObject(payload);
    await integrationCredentialRepo.upsert(deps.db, {
      provider,
      ...(opts.scope ? { scope: opts.scope } : {}),
      encryptedPayload,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    });
  },

  async read(
    deps: CredentialsServiceDeps,
    provider: string,
    opts: { scope?: string } = {},
  ): Promise<CredentialPayload | null> {
    const row = await integrationCredentialRepo.get(deps.db, provider, opts.scope ?? 'default');
    if (!row) return null;
    try {
      return deps.cipher.decryptObject<CredentialPayload>(row.encryptedPayload);
    } catch (err) {
      throw new AppError('Failed to decrypt integration credentials', {
        code: 'internal_error',
        status: 500,
        cause: err,
      });
    }
  },

  async delete(
    deps: CredentialsServiceDeps,
    provider: string,
    opts: { scope?: string } = {},
  ): Promise<void> {
    await integrationCredentialRepo.delete(deps.db, provider, opts.scope ?? 'default');
  },
};
