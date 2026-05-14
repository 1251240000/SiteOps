/**
 * Browser-side fetch wrapper used by TanStack Query hooks.
 *
 * Responsibilities:
 *  - Prefix all paths with `/api/v1/`
 *  - Send/receive JSON; auto-throw on non-2xx and re-shape into `ApiError`
 *    so TanStack Query's `error` is structured
 *  - Bubble up `requestId` from the response so the UI can surface it in
 *    error toasts ("Something went wrong · req_abc…")
 *
 * Auth: browser calls rely on the Auth.js session cookie set by Credentials
 * login, so we do not attach `Authorization` headers here. External Agent
 * callers (out-of-scope for the dashboard) use API keys via `withApiKey`.
 */

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: unknown;

  constructor(
    message: string,
    init: {
      status: number;
      code: string;
      requestId?: string | undefined;
      details?: unknown;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

export type ApiSuccess<T> = { data: T; meta?: Record<string, unknown> };

export type ApiRequestInit = Omit<RequestInit, 'body'> & {
  /** JSON body. Will be `JSON.stringify`'d and content-type set. */
  json?: unknown;
  /** Path under `/api/v1/`, with or without a leading `/`. */
  query?: Record<string, string | number | boolean | undefined>;
};

function buildUrl(path: string, query?: ApiRequestInit['query']): string {
  const base = path.startsWith('/api/') ? path : `/api/v1/${path.replace(/^\/+/, '')}`;
  if (!query) return base;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: ApiRequestInit = {},
): Promise<ApiSuccess<T>> {
  const { json, query, headers, ...rest } = init;
  const url = buildUrl(path, query);
  const res = await fetch(url, {
    ...rest,
    headers: {
      Accept: 'application/json',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    credentials: 'same-origin',
  });

  // 204 No Content (used for some delete/patch endpoints).
  if (res.status === 204) {
    return { data: undefined as unknown as T };
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    if (!res.ok) {
      throw new ApiError(`Request failed (${res.status})`, {
        status: res.status,
        code: 'invalid_response',
      });
    }
    return { data: undefined as unknown as T };
  }

  if (!res.ok) {
    const body = payload as ApiErrorBody | undefined;
    const err = body?.error;
    throw new ApiError(err?.message ?? `Request failed (${res.status})`, {
      status: res.status,
      code: err?.code ?? 'unknown_error',
      requestId: err?.requestId ?? res.headers.get('x-request-id') ?? undefined,
      details: err?.details,
    });
  }

  return payload as ApiSuccess<T>;
}

/** Convenience wrappers; verbose options remain available via `apiFetch`. */
export const api = {
  get: <T = unknown>(path: string, init?: ApiRequestInit) =>
    apiFetch<T>(path, { ...init, method: 'GET' }),
  post: <T = unknown>(path: string, json?: unknown, init?: ApiRequestInit) =>
    apiFetch<T>(path, { ...init, method: 'POST', json }),
  patch: <T = unknown>(path: string, json?: unknown, init?: ApiRequestInit) =>
    apiFetch<T>(path, { ...init, method: 'PATCH', json }),
  delete: <T = unknown>(path: string, init?: ApiRequestInit) =>
    apiFetch<T>(path, { ...init, method: 'DELETE' }),
};
