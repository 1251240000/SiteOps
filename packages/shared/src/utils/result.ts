/**
 * Result<T, E> — a tiny exception-free return type for control flow that
 * would otherwise need try/catch. Use sparingly; prefer throwing AppError
 * across module boundaries.
 */

export type Ok<T> = { ok: true; value: T };
export type Err<E> = { ok: false; error: E };
export type Result<T, E = Error> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** Run an async function and wrap any thrown error as `Err`. */
export async function tryCatch<T, E = Error>(
  fn: () => Promise<T>,
  /** Optional adapter mapping a thrown unknown to your error type. */
  toError: (e: unknown) => E = (e) => e as E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(toError(e));
  }
}

/** Synchronous variant of `tryCatch`. */
export function tryCatchSync<T, E = Error>(
  fn: () => T,
  toError: (e: unknown) => E = (e) => e as E,
): Result<T, E> {
  try {
    return ok(fn());
  } catch (e) {
    return err(toError(e));
  }
}
