import { describe, expect, it } from 'vitest';

import * as sharedConst from '@siteops/shared/constants';

import {
  SITE_TYPES,
  SITE_STATUS,
  REPO_PROVIDERS,
  ANALYTICS_PROVIDERS,
  ADSENSE_STATUS,
} from '../sites.js';
import { AUDIT_TYPES, AUDIT_STATUS, FINDING_SEVERITY } from '../audits.js';
import {
  ALERT_SCOPES,
  ALERT_METRICS,
  ALERT_OPERATORS,
  ALERT_CHANNEL_TYPES,
  ALERT_STATUS,
} from '../alerts.js';
import { DEPLOYMENT_PROVIDERS, DEPLOYMENT_STATUS, DEPLOYMENT_TRIGGERS } from '../deployments.js';
import { ERROR_LEVELS, ERROR_SOURCES } from '../errors.js';
import { TASK_STATUS } from '../tasks.js';
import { AGENT_RUN_STATUS } from '../agent-runs.js';
import { WEBHOOK_PROVIDERS } from '../webhook-events.js';

/**
 * `@siteops/shared/constants` is the canonical source of truth for these
 * enums (used by services + UI). The DB schema files duplicate them inline
 * (CHECK constraints need string literals); this test fails fast if either
 * side drifts so any future change is caught in CI.
 *
 * When fixing a failure: update the shared constant AND the schema CHECK
 * AND the const tuple in the same PR. Migrations cannot weaken historical
 * CHECKs without a new migration.
 */
describe('schema constants ↔ @siteops/shared/constants', () => {
  const pairs: Array<[string, readonly string[], readonly string[]]> = [
    ['SITE_TYPES', SITE_TYPES, sharedConst.SITE_TYPES],
    ['SITE_STATUS', SITE_STATUS, sharedConst.SITE_STATUS],
    ['REPO_PROVIDERS', REPO_PROVIDERS, sharedConst.REPO_PROVIDERS],
    ['ANALYTICS_PROVIDERS', ANALYTICS_PROVIDERS, sharedConst.ANALYTICS_PROVIDERS],
    ['ADSENSE_STATUS', ADSENSE_STATUS, sharedConst.ADSENSE_STATUS],
    ['AUDIT_TYPES', AUDIT_TYPES, sharedConst.AUDIT_TYPES],
    ['AUDIT_STATUS', AUDIT_STATUS, sharedConst.AUDIT_STATUS],
    ['FINDING_SEVERITY', FINDING_SEVERITY, sharedConst.FINDING_SEVERITY],
    ['ALERT_SCOPES', ALERT_SCOPES, sharedConst.ALERT_SCOPES],
    ['ALERT_METRICS', ALERT_METRICS, sharedConst.ALERT_METRICS],
    ['ALERT_OPERATORS', ALERT_OPERATORS, sharedConst.ALERT_OPERATORS],
    ['ALERT_CHANNEL_TYPES', ALERT_CHANNEL_TYPES, sharedConst.ALERT_CHANNEL_TYPES],
    ['ALERT_STATUS', ALERT_STATUS, sharedConst.ALERT_STATUS],
    ['DEPLOYMENT_PROVIDERS', DEPLOYMENT_PROVIDERS, sharedConst.DEPLOYMENT_PROVIDERS],
    ['DEPLOYMENT_STATUS', DEPLOYMENT_STATUS, sharedConst.DEPLOYMENT_STATUS],
    ['DEPLOYMENT_TRIGGERS', DEPLOYMENT_TRIGGERS, sharedConst.DEPLOYMENT_TRIGGERS],
    ['ERROR_SOURCES', ERROR_SOURCES, sharedConst.ERROR_SOURCES],
    ['ERROR_LEVELS', ERROR_LEVELS, sharedConst.ERROR_LEVELS],
    ['TASK_STATUS', TASK_STATUS, sharedConst.TASK_STATUS],
    ['AGENT_RUN_STATUS', AGENT_RUN_STATUS, sharedConst.AGENT_RUN_STATUS],
    ['WEBHOOK_PROVIDERS', WEBHOOK_PROVIDERS, sharedConst.WEBHOOK_PROVIDERS],
  ];

  it.each(pairs)('%s matches between db schema and shared', (_name, dbArr, sharedArr) => {
    expect([...dbArr].sort()).toEqual([...sharedArr].sort());
    // Order matters for UI rendering (e.g. severity ladder).
    expect(dbArr).toEqual(sharedArr);
  });
});
