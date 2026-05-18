/**
 * API-key management service.
 *
 * Holds the policy that the repository deliberately doesn't:
 *   - generate-then-hash on `create`, returning the plaintext exactly once
 *   - reject when the active-key cap is reached
 *   - normalise scopes (`['*']` collapses to wildcard, dedup)
 *   - log every issue/revoke for audit
 */
import {
  apiKeyRepo,
  type ApiKeyListOptions,
  type ApiKeyListPage,
  type ApiKeyView,
  type Db,
} from '@siteops/db';
import {
  AppError,
  API_KEY_MAX_ACTIVE,
  API_KEY_WILDCARD,
  generateApiKey,
  type ApiKeyScope,
} from '@siteops/shared';

export type { ApiKeyListPage, ApiKeyView };

export type ApiKeyServiceDeps = {
  db: Db;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    warn: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

export type CreateApiKeyServiceInput = {
  name: string;
  scopes: Array<ApiKeyScope | typeof API_KEY_WILDCARD>;
  /** ISO datetime, or `undefined` for never-expires. Caller pre-validates. */
  expiresAt?: string;
};

export type CreateApiKeyResult = {
  /** Safe row view (no `key_hash`). */
  apiKey: ApiKeyView;
  /** Plaintext token shown to the admin **once** at creation time. */
  plaintext: string;
};

function normaliseScopes(
  scopes: Array<ApiKeyScope | typeof API_KEY_WILDCARD>,
): Array<ApiKeyScope | typeof API_KEY_WILDCARD> {
  if (scopes.includes(API_KEY_WILDCARD)) return [API_KEY_WILDCARD];
  return Array.from(new Set(scopes));
}

export const apiKeyService = {
  async list(deps: ApiKeyServiceDeps, opts: ApiKeyListOptions = {}): Promise<ApiKeyListPage> {
    return apiKeyRepo.list(deps.db, opts);
  },

  async getById(deps: ApiKeyServiceDeps, id: string): Promise<ApiKeyView> {
    const row = await apiKeyRepo.getById(deps.db, id);
    if (!row) {
      throw new AppError('API key not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    return row;
  },

  async create(
    deps: ApiKeyServiceDeps,
    input: CreateApiKeyServiceInput,
  ): Promise<CreateApiKeyResult> {
    const active = await apiKeyRepo.countActive(deps.db);
    if (active >= API_KEY_MAX_ACTIVE) {
      throw new AppError(`Cannot create more than ${API_KEY_MAX_ACTIVE} active API keys`, {
        code: 'conflict',
        status: 409,
        details: { active, limit: API_KEY_MAX_ACTIVE },
      });
    }

    const generated = await generateApiKey();
    const scopes = normaliseScopes(input.scopes);
    const created = await apiKeyRepo.create(deps.db, {
      name: input.name.trim(),
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      scopes: scopes as string[],
      ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt) } : {}),
    });
    deps.logger?.info(
      {
        event: 'api_key.created',
        apiKeyId: created.id,
        scopes,
        expiresAt: created.expiresAt,
      },
      'api key issued',
    );
    return { apiKey: created, plaintext: generated.plaintext };
  },

  /**
   * Idempotent — revoking an already-revoked key returns the same row
   * without re-stamping `revoked_at`. 404s when the id is unknown.
   */
  async revoke(deps: ApiKeyServiceDeps, id: string): Promise<ApiKeyView> {
    const row = await apiKeyRepo.revoke(deps.db, id);
    if (!row) {
      throw new AppError('API key not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    deps.logger?.info({ event: 'api_key.revoked', apiKeyId: row.id }, 'api key revoked');
    return row;
  },
};
