import { z, type ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod';

import { AppError } from '../errors.js';

export type EnvSource = Record<string, string | undefined>;

/**
 * Parse a process-style env object against a Zod schema. Throws `AppError`
 * (`code: 'invalid_env'`) on failure with a flat list of missing/invalid
 * keys so dev tooling can surface them clearly.
 *
 * The `source` parameter is required (no `process.env` default) so this
 * module stays free of side effects and runs cleanly under browser bundlers.
 */
export function parseEnv<Schema extends ZodTypeAny>(
  schema: Schema,
  source: EnvSource,
): ZodInfer<Schema> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  const issues = formatZodIssues(result.error);
  throw new AppError(`Invalid env: ${issues.map((i) => i.path).join(', ')}`, {
    code: 'invalid_env',
    status: 500,
    details: { issues },
    cause: result.error,
  });
}

function formatZodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
}

/** Re-export `z` for callers who only want one import. */
export { z };
