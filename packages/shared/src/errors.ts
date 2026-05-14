/**
 * Domain error hierarchy. Service layer throws these; the API layer
 * (`withApi()` wrapper) translates them into HTTP responses.
 *
 * Design notes:
 * - `code` is a machine-readable, stable string (snake_case).
 * - `status` is the suggested HTTP status code.
 * - `details` carries structured context for clients / logs.
 * - `cause` preserves the original error (use `{ cause }` constructor option).
 */

export type AppErrorOptions = {
  /** Stable, snake_case identifier. */
  code: string;
  /** Suggested HTTP status code. */
  status?: number;
  /** Structured context for clients (avoid PII). */
  details?: Record<string, unknown>;
  /** Underlying cause (will be chained via Error `cause`). */
  cause?: unknown;
};

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = options.code;
    this.status = options.status ?? 500;
    if (options.details !== undefined) this.details = options.details;
  }

  toJSON(): { code: string; message: string; details?: Record<string, unknown> } {
    const out: { code: string; message: string; details?: Record<string, unknown> } = {
      code: this.code,
      message: this.message,
    };
    if (this.details !== undefined) out.details = this.details;
    return out;
  }
}

/**
 * Validation failure, typically wrapping a ZodError. Suggested HTTP 400.
 */
export class ValidationError extends AppError {
  constructor(message: string, options: Omit<AppErrorOptions, 'code' | 'status'> = {}) {
    super(message, {
      code: 'validation_error',
      status: 400,
      ...(options.details !== undefined ? { details: options.details } : {}),
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = 'ValidationError';
  }
}

/**
 * Upstream / external API failure. Always carries the source identifier so
 * dashboards can route alerts (e.g. `cloudflare`, `github`, `ga4`).
 */
export class UpstreamError extends AppError {
  readonly source: string;
  readonly upstreamStatus?: number;

  constructor(
    message: string,
    options: Omit<AppErrorOptions, 'code'> & { source: string; upstreamStatus?: number },
  ) {
    super(message, {
      code: 'upstream_error',
      status: options.status ?? 502,
      ...(options.details !== undefined ? { details: options.details } : {}),
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = 'UpstreamError';
    this.source = options.source;
    if (options.upstreamStatus !== undefined) this.upstreamStatus = options.upstreamStatus;
  }
}

/** Convenience type guard used by API layer. */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
