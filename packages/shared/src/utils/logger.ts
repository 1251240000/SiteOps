import { pino, type Logger, type LoggerOptions } from 'pino';

/**
 * Shared logger factory. Apps inject their own transport (e.g. pino-pretty
 * in dev, JSON in prod) by passing custom options or wrapping the returned
 * instance.
 */

export type { Logger } from 'pino';

export type CreateLoggerOptions = LoggerOptions & {
  /** Logical name; appears as `name` field on every record. */
  name?: string;
  /** Static bindings merged into every log record. */
  bindings?: Record<string, unknown>;
};

const DEFAULT_LEVEL = process.env['LOG_LEVEL'] ?? 'info';

/**
 * Create a pino logger. Defaults are conservative (JSON, level from
 * `LOG_LEVEL` or `info`) so this works in both Node services and the
 * browser shim that pino ships.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const { bindings, ...rest } = options;
  const logger = pino({
    level: DEFAULT_LEVEL,
    ...rest,
  });
  return bindings ? logger.child(bindings) : logger;
}

/**
 * Singleton convenience for one-off scripts and tests. Apps with a DI
 * container should prefer `createLogger()` and pass the instance around.
 */
let rootLogger: Logger | undefined;
export function getRootLogger(): Logger {
  if (!rootLogger) rootLogger = createLogger({ name: 'siteops' });
  return rootLogger;
}
