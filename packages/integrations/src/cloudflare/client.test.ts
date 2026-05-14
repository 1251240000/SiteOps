import { describe, expect, it } from 'vitest';

import { CloudflareClient, CloudflareError, type CfFetch } from './client.js';
import { mapDeploymentStatus, normalizeDeployment } from './mapper.js';
import type { CfPagesDeployment } from './types.js';

function mockFetch(
  handler: (input: string, init?: RequestInit) => Response | Promise<Response>,
): CfFetch {
  return (input, init) => Promise.resolve(handler(input, init));
}

function envelope<T>(result: T, init: { success?: boolean } = {}) {
  return new Response(
    JSON.stringify({
      success: init.success ?? true,
      errors: [],
      messages: [],
      result,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function errorEnvelope(status: number, code = 1000, message = 'failure') {
  return new Response(
    JSON.stringify({
      success: false,
      errors: [{ code, message }],
      messages: [],
      result: null,
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

describe('CloudflareClient.verifyToken', () => {
  it('returns result on success', async () => {
    const client = new CloudflareClient({
      apiToken: 'tk',
      fetch: mockFetch(() => envelope({ id: 'abc', status: 'active' })),
    });
    const res = await client.verifyToken();
    expect(res.id).toBe('abc');
    expect(res.status).toBe('active');
  });

  it('classifies 401 as auth_failed and does not retry', async () => {
    let calls = 0;
    const client = new CloudflareClient({
      apiToken: 'tk',
      maxRetries: 2,
      retryBaseMs: 1,
      fetch: mockFetch(() => {
        calls += 1;
        return errorEnvelope(401, 1001, 'bad token');
      }),
    });
    let caught: unknown;
    try {
      await client.verifyToken();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudflareError);
    expect((caught as CloudflareError).code).toBe('auth_failed');
    expect(calls).toBe(1);
  });

  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    const client = new CloudflareClient({
      apiToken: 'tk',
      maxRetries: 3,
      retryBaseMs: 1,
      fetch: mockFetch(() => {
        calls += 1;
        if (calls < 3) return errorEnvelope(503, 9999, 'transient');
        return envelope({ id: 'ok', status: 'active' });
      }),
    });
    const res = await client.verifyToken();
    expect(res.id).toBe('ok');
    expect(calls).toBe(3);
  });

  it('gives up after maxRetries on persistent 5xx', async () => {
    let calls = 0;
    const client = new CloudflareClient({
      apiToken: 'tk',
      maxRetries: 2,
      retryBaseMs: 1,
      fetch: mockFetch(() => {
        calls += 1;
        return errorEnvelope(500);
      }),
    });
    let caught: unknown;
    try {
      await client.verifyToken();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CloudflareError);
    expect(calls).toBe(3); // 1 initial + 2 retries
  });
});

describe('CloudflareClient.listDeployments', () => {
  it('filters out deployments older than `since`', async () => {
    const oldDate = '2025-01-01T00:00:00Z';
    const newDate = '2026-04-01T00:00:00Z';
    const client = new CloudflareClient({
      apiToken: 'tk',
      fetch: mockFetch(() =>
        envelope([
          {
            id: 'new',
            project_name: 'p',
            environment: 'production',
            created_on: newDate,
            stages: [],
          },
          {
            id: 'old',
            project_name: 'p',
            environment: 'production',
            created_on: oldDate,
            stages: [],
          },
        ]),
      ),
    });
    const out = await client.listDeployments('acc', 'p', {
      since: new Date('2026-01-01T00:00:00Z'),
    });
    expect(out.map((d) => d.id)).toEqual(['new']);
  });
});

describe('mapDeploymentStatus', () => {
  function dep(stages: Array<{ name: string; status: string }>): CfPagesDeployment {
    return {
      id: 'x',
      project_name: 'p',
      environment: 'production',
      created_on: '2026-01-01T00:00:00Z',
      stages,
    };
  }
  it('maps deploy stage success to success', () => {
    expect(
      mapDeploymentStatus(
        dep([
          { name: 'queued', status: 'success' },
          { name: 'build', status: 'success' },
          { name: 'deploy', status: 'success' },
        ]),
      ),
    ).toBe('success');
  });

  it('maps any failure stage to failed', () => {
    expect(
      mapDeploymentStatus(
        dep([
          { name: 'queued', status: 'success' },
          { name: 'build', status: 'failure' },
        ]),
      ),
    ).toBe('failed');
  });

  it('maps active to building', () => {
    expect(
      mapDeploymentStatus(
        dep([
          { name: 'queued', status: 'success' },
          { name: 'build', status: 'active' },
        ]),
      ),
    ).toBe('building');
  });

  it('falls back to queued when no signal', () => {
    expect(mapDeploymentStatus(dep([]))).toBe('queued');
  });
});

describe('normalizeDeployment', () => {
  it('extracts commit metadata + log url', () => {
    const out = normalizeDeployment({
      id: 'd1',
      project_name: 'p',
      environment: 'production',
      created_on: '2026-01-01T00:00:00Z',
      url: 'https://d1.example.pages.dev',
      deployment_trigger: {
        metadata: {
          commit_hash: 'abc123',
          commit_message: 'feat: thing',
          branch: 'main',
        },
      },
      stages: [
        { name: 'queued', status: 'success', started_on: '2026-01-01T00:00:00Z' },
        { name: 'build', status: 'success', started_on: '2026-01-01T00:00:10Z' },
        {
          name: 'deploy',
          status: 'success',
          started_on: '2026-01-01T00:01:00Z',
          ended_on: '2026-01-01T00:02:00Z',
        },
      ],
    });
    expect(out.providerDeploymentId).toBe('d1');
    expect(out.status).toBe('success');
    expect(out.commitSha).toBe('abc123');
    expect(out.branch).toBe('main');
    expect(out.commitMessage).toBe('feat: thing');
    expect(out.buildLogUrl).toBe('https://d1.example.pages.dev');
    expect(out.startedAt).toBe('2026-01-01T00:00:10Z');
    expect(out.finishedAt).toBe('2026-01-01T00:02:00Z');
  });
});
