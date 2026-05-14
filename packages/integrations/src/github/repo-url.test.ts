import { describe, expect, it } from 'vitest';

import { parseRepoUrl } from './repo-url.js';

describe('parseRepoUrl', () => {
  it.each([
    ['https://github.com/octocat/Hello-World', { owner: 'octocat', repo: 'Hello-World' }],
    ['https://github.com/octocat/Hello-World.git', { owner: 'octocat', repo: 'Hello-World' }],
    ['https://github.com/octocat/Hello-World/', { owner: 'octocat', repo: 'Hello-World' }],
    ['https://github.com/octocat/Hello-World/tree/main', { owner: 'octocat', repo: 'Hello-World' }],
    ['git@github.com:octocat/Hello-World.git', { owner: 'octocat', repo: 'Hello-World' }],
    ['ssh://git@github.com/octocat/Hello-World.git', { owner: 'octocat', repo: 'Hello-World' }],
    ['octocat/Hello-World', { owner: 'octocat', repo: 'Hello-World' }],
    ['github:octocat/Hello-World', { owner: 'octocat', repo: 'Hello-World' }],
  ])('parses %s', (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected);
  });

  it.each([
    '',
    null,
    undefined,
    'https://gitlab.com/owner/repo',
    'not a url',
    'owner-only',
    'https://github.com/onlyOwner',
    'git@bitbucket.org:owner/repo.git',
  ])('returns null for %s', (input) => {
    expect(parseRepoUrl(input)).toBeNull();
  });
});
