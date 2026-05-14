import { describe, expect, it } from 'vitest';

import { GitHubClient, GitHubError, type GhFetch } from './client.js';
import { mapWorkflowRunStatus, workflowRunToDeployment } from './mapper.js';
import type { GhWorkflowRun } from './types.js';

function fetchOk<T>(body: T, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fetchStatus(status: number, body: unknown = { message: 'x' }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mock(
  handler: (input: string, init?: RequestInit) => Response | Promise<Response>,
): GhFetch {
  return (input, init) => Promise.resolve(handler(input, init));
}

describe('GitHubClient.verifyToken', () => {
  it('returns user payload + records rate-limit headers', async () => {
    const client = new GitHubClient({
      token: 't',
      fetch: mock(() =>
        fetchOk(
          { login: 'octocat', id: 1 },
          {
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': '1700000000',
          },
        ),
      ),
    });
    const user = await client.verifyToken();
    expect(user.login).toBe('octocat');
    expect(client.getRateLimit()).toEqual({
      limit: 5000,
      remaining: 4999,
      reset: 1700000000,
    });
  });

  it('classifies 401 as auth_failed and surfaces server message', async () => {
    const client = new GitHubClient({
      token: 't',
      maxRetries: 0,
      retryBaseMs: 1,
      fetch: mock(() => fetchStatus(401, { message: 'Bad credentials' })),
    });
    let caught: unknown;
    try {
      await client.verifyToken();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GitHubError);
    const e = caught as GitHubError;
    expect(e.code).toBe('auth_failed');
    expect(e.message).toContain('Bad credentials');
  });
});

describe('mapWorkflowRunStatus', () => {
  function run(p: Partial<GhWorkflowRun>): GhWorkflowRun {
    return {
      id: 1,
      head_sha: 'a',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/o/r/actions/runs/1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:01:00Z',
      ...p,
    };
  }
  it('success → success', () => expect(mapWorkflowRunStatus(run({}))).toBe('success'));
  it('failure → failed', () =>
    expect(mapWorkflowRunStatus(run({ conclusion: 'failure' }))).toBe('failed'));
  it('cancelled → cancelled', () =>
    expect(mapWorkflowRunStatus(run({ conclusion: 'cancelled' }))).toBe('cancelled'));
  it('in_progress → building', () =>
    expect(mapWorkflowRunStatus(run({ status: 'in_progress', conclusion: null }))).toBe(
      'building',
    ));
  it('queued → queued', () =>
    expect(mapWorkflowRunStatus(run({ status: 'queued', conclusion: null }))).toBe('queued'));
});

describe('workflowRunToDeployment', () => {
  it('classifies Pages workflow as github_pages', () => {
    const mapped = workflowRunToDeployment({
      id: 7,
      name: 'pages build and deployment',
      head_sha: 'sha',
      head_branch: 'gh-pages',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/o/r/actions/runs/7',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:02:00Z',
    });
    expect(mapped.provider).toBe('github_pages');
    expect(mapped.providerDeploymentId).toBe('gh-7');
    expect(mapped.status).toBe('success');
    expect(mapped.branch).toBe('gh-pages');
    expect(mapped.commitSha).toBe('sha');
    expect(mapped.buildLogUrl).toBe('https://github.com/o/r/actions/runs/7');
  });

  it('classifies other workflows as manual', () => {
    const mapped = workflowRunToDeployment({
      id: 8,
      name: 'ci',
      head_sha: 'sha',
      head_branch: 'main',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/o/r/actions/runs/8',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:02:00Z',
    });
    expect(mapped.provider).toBe('manual');
  });
});
