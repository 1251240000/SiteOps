import type { Db } from '@siteops/db';
import type { Logger } from '@siteops/shared';

/**
 * Application-level DI container.
 *
 * Kept intentionally tiny — no IoC framework. Each app constructs one of
 * these at boot and passes it through service / API layers explicitly.
 *
 * `queues` is a forward declaration: the BullMQ Queue map lands in T11
 * (uptime worker). Until then, services may declare optional dependencies
 * via narrowed sub-types (`Pick<Container, 'db' | 'logger'>`).
 */
export type Container = {
  db: Db;
  logger: Logger;
  queues: Queues;
};

/**
 * Placeholder for the queue registry. Populated by `apps/worker` when
 * BullMQ ships in T11; until then any worker-less app may pass `{}`.
 */
export type Queues = Record<string, unknown>;

export type CreateContainerOptions = {
  db: Db;
  logger: Logger;
  queues?: Queues;
};

export function createContainer(options: CreateContainerOptions): Container {
  return {
    db: options.db,
    logger: options.logger,
    queues: options.queues ?? {},
  };
}
