/**
 * Deployment service.
 *
 * Wraps `deploymentRepo` with:
 *   - idempotent upsert via `(provider, providerDeploymentId)` so re-fired
 *     webhooks don't generate duplicate rows
 *   - status state-machine enforcement on update (queued → building → terminal)
 *   - automatic `durationMs` when `finishedAt` is supplied
 *   - structured logger events on every mutation
 *
 * Errors surface as `AppError` so route handlers can pass them straight
 * through to the canonical error envelope.
 */
import {
  deploymentRepo,
  type Db,
  type Deployment,
  type DeploymentListOptions,
  type DeploymentListPage,
  type NewDeployment,
} from '@siteops/db';
import {
  AppError,
  canTransitionDeployment,
  type CreateDeploymentInput,
  isTerminalDeploymentStatus,
} from '@siteops/shared';

export type { Deployment, DeploymentListPage };

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

function computeDurationMs(
  startedAt: Date | string | null | undefined,
  finishedAt: Date | string | null | undefined,
): number | null {
  if (!startedAt || !finishedAt) return null;
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const end = finishedAt instanceof Date ? finishedAt : new Date(finishedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diff = end.getTime() - start.getTime();
  return diff < 0 ? null : diff;
}

function inputToInsert(input: CreateDeploymentInput): NewDeployment {
  const startedAt = input.startedAt ? new Date(input.startedAt) : undefined;
  const finishedAt = input.finishedAt ? new Date(input.finishedAt) : undefined;
  const durationMs = computeDurationMs(startedAt, finishedAt);
  return stripUndefined({
    siteId: input.siteId,
    provider: input.provider,
    providerDeploymentId: input.providerDeploymentId,
    commitSha: input.commitSha,
    commitMessage: input.commitMessage,
    branch: input.branch,
    status: input.status,
    startedAt,
    finishedAt,
    durationMs: durationMs ?? undefined,
    buildLogUrl: input.buildLogUrl,
    triggeredBy: input.triggeredBy,
  }) as NewDeployment;
}

function inputToPatch(input: CreateDeploymentInput): Partial<NewDeployment> {
  const startedAt = input.startedAt ? new Date(input.startedAt) : undefined;
  const finishedAt = input.finishedAt ? new Date(input.finishedAt) : undefined;
  return stripUndefined({
    commitSha: input.commitSha,
    commitMessage: input.commitMessage,
    branch: input.branch,
    status: input.status,
    startedAt,
    finishedAt,
    buildLogUrl: input.buildLogUrl,
    triggeredBy: input.triggeredBy,
  }) as Partial<NewDeployment>;
}

export type DeploymentServiceDeps = {
  db: Db;
  logger?: {
    info: (obj: Record<string, unknown>, msg?: string) => void;
    warn: (obj: Record<string, unknown>, msg?: string) => void;
  };
};

export type CreateDeploymentResult = {
  deployment: Deployment;
  /** `true` if a brand-new row was inserted; `false` if the call was deduped. */
  created: boolean;
};

export const deploymentService = {
  async list(
    deps: DeploymentServiceDeps,
    opts: DeploymentListOptions,
  ): Promise<DeploymentListPage> {
    return deploymentRepo.list(deps.db, opts);
  },

  async listForSite(
    deps: DeploymentServiceDeps,
    siteId: string,
    opts: { limit?: number } = {},
  ): Promise<Deployment[]> {
    return deploymentRepo.listForSite(deps.db, siteId, opts);
  },

  async getById(deps: DeploymentServiceDeps, id: string): Promise<Deployment> {
    const row = await deploymentRepo.getById(deps.db, id);
    if (!row) {
      throw new AppError('Deployment not found', {
        code: 'not_found',
        status: 404,
        details: { id },
      });
    }
    return row;
  },

  /**
   * Create or upsert. If a row exists for `(provider, providerDeploymentId)`
   * we apply the same state-machine rules as a manual PATCH would, then
   * return the merged row. The dashboard form uses `provider='manual'` and
   * never sends `providerDeploymentId`, so manual entries always insert.
   */
  async create(
    deps: DeploymentServiceDeps,
    input: CreateDeploymentInput,
  ): Promise<CreateDeploymentResult> {
    if (input.provider && input.providerDeploymentId) {
      const existing = await deploymentRepo.getByProviderId(
        deps.db,
        input.provider,
        input.providerDeploymentId,
      );
      if (existing) {
        const merged = await this.applyStatusUpdate(deps, existing, input);
        return { deployment: merged, created: false };
      }
    }

    const insert = inputToInsert(input);
    const created = await deploymentRepo.create(deps.db, insert);
    deps.logger?.info(
      {
        event: 'deployment.created',
        deploymentId: created.id,
        siteId: created.siteId,
        provider: created.provider,
        status: created.status,
      },
      'deployment created',
    );
    return { deployment: created, created: true };
  },

  /**
   * Apply a status update to an existing deployment with the state-machine
   * gate. Used by both `create` (upsert path) and the route's PATCH handler.
   */
  async applyStatusUpdate(
    deps: DeploymentServiceDeps,
    existing: Deployment,
    input: CreateDeploymentInput,
  ): Promise<Deployment> {
    if (!canTransitionDeployment(existing.status, input.status)) {
      throw new AppError(
        `Cannot transition deployment from ${existing.status} to ${input.status}`,
        {
          code: 'conflict',
          status: 409,
          details: {
            from: existing.status,
            to: input.status,
            terminal: isTerminalDeploymentStatus(existing.status),
          },
        },
      );
    }

    const patch = inputToPatch(input);

    // Auto-compute durationMs when we now have both timestamps.
    const startedAt = (patch.startedAt ?? existing.startedAt) as Date | null | undefined;
    const finishedAt = (patch.finishedAt ?? existing.finishedAt) as Date | null | undefined;
    const duration = computeDurationMs(startedAt, finishedAt);
    if (duration !== null && existing.durationMs == null) {
      (patch as Partial<NewDeployment>).durationMs = duration;
    }

    const updated = await deploymentRepo.update(deps.db, existing.id, patch);
    if (!updated) {
      throw new AppError('Deployment vanished mid-update', {
        code: 'not_found',
        status: 404,
        details: { id: existing.id },
      });
    }
    deps.logger?.info(
      {
        event: 'deployment.updated',
        deploymentId: updated.id,
        siteId: updated.siteId,
        from: existing.status,
        to: updated.status,
        durationMs: updated.durationMs,
      },
      'deployment updated',
    );
    return updated;
  },
};

export { computeDurationMs };
