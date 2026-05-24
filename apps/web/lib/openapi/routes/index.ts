/**
 * Barrel that wires every per-noun registrar into the shared
 * `OpenAPIRegistry`. Each register* function is responsible for its own
 * `registry.registerPath(...)` calls; this file only orders them.
 *
 * Adding a new route group:
 *   1. Create `routes/<noun>.ts` exporting `registerXxx(registry)`.
 *   2. Append `registerXxx(registry)` here.
 *   3. Run `pnpm openapi:generate` to refresh `docs/openapi.json`.
 */
import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

import { registerAgentRuns } from './agent-runs';
import { registerAlerts } from './alerts';
import { registerAudits } from './audits';
import { registerAuth } from './auth';
import { registerDeployments } from './deployments';
import { registerDomains } from './domains';
import { registerErrors } from './errors';
import { registerHooks } from './hooks';
import { registerIntegrations } from './integrations';
import { registerMe } from './me';
import { registerMetrics } from './metrics';
import { registerRevenue } from './revenue';
import { registerRoi } from './roi';
import { registerSettings } from './settings';
import { registerSites } from './sites';
import { registerSystem } from './system';
import { registerTasks } from './tasks';

export function registerAll(registry: OpenAPIRegistry): void {
  registerAuth(registry);
  registerSites(registry);
  registerDomains(registry);
  registerDeployments(registry);
  registerAudits(registry);
  registerErrors(registry);
  registerAlerts(registry);
  registerMetrics(registry);
  registerRevenue(registry);
  registerRoi(registry);
  registerTasks(registry);
  registerAgentRuns(registry);
  registerIntegrations(registry);
  registerHooks(registry);
  registerSettings(registry);
  registerSystem(registry);
  registerMe(registry);
}
