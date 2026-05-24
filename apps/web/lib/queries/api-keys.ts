/**
 * React-Query keys + wire types for the API-keys settings page.
 */
export type ApiKeyState = 'active' | 'revoked' | 'expired';

export type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  /**
   * Per-key override of the global `API_KEY_RATE_LIMIT_PER_MIN` (T38).
   * `null` means the key uses the env default (typically 600/min).
   */
  rateLimitPerMin: number | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type CreateApiKeyResponse = {
  apiKey: ApiKeyRow;
  /** Plaintext token shown to the admin **once** at creation time. */
  plaintext: string;
};

export const apiKeysKeys = {
  all: ['api-keys'] as const,
  lists: () => [...apiKeysKeys.all, 'list'] as const,
  list: (state: ApiKeyState | 'all') => [...apiKeysKeys.lists(), state] as const,
};
