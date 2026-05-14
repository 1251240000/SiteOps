import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDb, type TestDbHandle } from '@siteops/db/testing';

import { AlertCipher } from '../../alerts/cipher.js';
import { credentialsService } from '../credentials-service.js';

let handle: TestDbHandle;

beforeAll(async () => {
  handle = await createTestDb();
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await handle.reset();
});

describe('credentialsService', () => {
  const cipher = new AlertCipher('test-key-material');

  it('round-trips a payload', async () => {
    await credentialsService.save({ db: handle.db as never, cipher }, 'gsc', {
      refreshToken: 'r1',
      accessToken: 'a1',
      expiresAt: '2026-01-01T00:00:00Z',
      scope: 's',
    });
    const read = await credentialsService.read({ db: handle.db as never, cipher }, 'gsc');
    expect(read?.refreshToken).toBe('r1');
    expect(read?.accessToken).toBe('a1');
  });

  it('overwrites on conflict (provider, scope)', async () => {
    await credentialsService.save({ db: handle.db as never, cipher }, 'gsc', {
      refreshToken: 'first',
    });
    await credentialsService.save({ db: handle.db as never, cipher }, 'gsc', {
      refreshToken: 'second',
    });
    const read = await credentialsService.read({ db: handle.db as never, cipher }, 'gsc');
    expect(read?.refreshToken).toBe('second');
  });

  it('isolates by scope', async () => {
    await credentialsService.save(
      { db: handle.db as never, cipher },
      'adsense',
      { refreshToken: 'r-default' },
      { scope: 'default' },
    );
    await credentialsService.save(
      { db: handle.db as never, cipher },
      'adsense',
      { refreshToken: 'r-account-2' },
      { scope: 'account-2' },
    );
    const a = await credentialsService.read({ db: handle.db as never, cipher }, 'adsense');
    const b = await credentialsService.read({ db: handle.db as never, cipher }, 'adsense', {
      scope: 'account-2',
    });
    expect(a?.refreshToken).toBe('r-default');
    expect(b?.refreshToken).toBe('r-account-2');
  });

  it('returns null when missing', async () => {
    const read = await credentialsService.read({ db: handle.db as never, cipher }, 'gsc');
    expect(read).toBeNull();
  });
});
