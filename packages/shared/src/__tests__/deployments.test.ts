import { describe, expect, it } from 'vitest';

import {
  DEPLOYMENT_STATE_TRANSITIONS,
  DEPLOYMENT_STATUS,
  canTransitionDeployment,
  isTerminalDeploymentStatus,
} from '../constants/deployments.js';

describe('deployment state machine', () => {
  it('queued can advance, lateral, or terminate', () => {
    expect(canTransitionDeployment('queued', 'building')).toBe(true);
    expect(canTransitionDeployment('queued', 'queued')).toBe(true);
    expect(canTransitionDeployment('queued', 'failed')).toBe(true);
    expect(canTransitionDeployment('queued', 'cancelled')).toBe(true);
    expect(canTransitionDeployment('queued', 'success')).toBe(false);
  });

  it('building can finish or cancel but cannot go back to queued', () => {
    expect(canTransitionDeployment('building', 'success')).toBe(true);
    expect(canTransitionDeployment('building', 'failed')).toBe(true);
    expect(canTransitionDeployment('building', 'cancelled')).toBe(true);
    expect(canTransitionDeployment('building', 'queued')).toBe(false);
  });

  it('terminal statuses cannot change', () => {
    for (const terminal of ['success', 'failed', 'cancelled'] as const) {
      for (const other of DEPLOYMENT_STATUS) {
        const allowed = canTransitionDeployment(terminal, other);
        expect(allowed).toBe(other === terminal);
      }
    }
  });

  it('transition map covers every status', () => {
    for (const s of DEPLOYMENT_STATUS) {
      expect(DEPLOYMENT_STATE_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('isTerminalDeploymentStatus tags only finished states', () => {
    expect(isTerminalDeploymentStatus('success')).toBe(true);
    expect(isTerminalDeploymentStatus('failed')).toBe(true);
    expect(isTerminalDeploymentStatus('cancelled')).toBe(true);
    expect(isTerminalDeploymentStatus('queued')).toBe(false);
    expect(isTerminalDeploymentStatus('building')).toBe(false);
  });
});
