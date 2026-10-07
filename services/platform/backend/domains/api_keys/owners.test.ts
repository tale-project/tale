// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { readApiKeyOwner, readServicePrincipal } from './owners.ts';

/**
 * The binding of a key to one organization, read by the REST door and by
 * every reader that asks who a request acts as. A row of a kind this module
 * does not know must never read as a person's own key, which would work in
 * every organization of its identity.
 */

function fakeSql(row: Record<string, unknown> | null): Sql {
  const tag = () => Promise.resolve(row === null ? [] : [row]);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return tag as unknown as Sql;
}

const ROW = {
  apiKeyId: 'key-1',
  organizationId: 'org-1',
  kind: 'team',
  principalUserId: 'identity-1',
  teamId: 'finance',
  projectId: null,
  role: 'editor',
  name: 'Finance export',
  createdBy: 'ada',
  createdAt: '1760000000000',
  revokedAt: null,
  revokedBy: null,
};

describe('readApiKeyOwner', () => {
  it('reads the binding, its stamps as numbers', async () => {
    await expect(readApiKeyOwner(fakeSql(ROW), 'key-1')).resolves.toEqual({
      ...ROW,
      createdAt: 1_760_000_000_000,
    });
  });

  it('reads no binding as a person’s own key, and reads none for no key', async () => {
    await expect(readApiKeyOwner(fakeSql(null), 'key-1')).resolves.toBeNull();
    await expect(readApiKeyOwner(fakeSql(ROW), '')).resolves.toBeNull();
  });

  it('fails the request on a kind it does not know rather than read it as a person’s key', async () => {
    await expect(
      readApiKeyOwner(fakeSql({ ...ROW, kind: 'robot' }), 'key-1'),
    ).rejects.toThrow('unknown owner kind "robot"');
  });

  it('drops a role it does not know', async () => {
    await expect(
      readApiKeyOwner(fakeSql({ ...ROW, role: 'owner' }), 'key-1'),
    ).resolves.toMatchObject({ role: null });
  });
});

describe('readServicePrincipal', () => {
  it('names the key whose identity a user id is, and no one for an unknown kind', async () => {
    await expect(
      readServicePrincipal(fakeSql(ROW), 'identity-1'),
    ).resolves.toMatchObject({ kind: 'team', apiKeyId: 'key-1' });
    await expect(
      readServicePrincipal(fakeSql({ ...ROW, kind: 'robot' }), 'identity-1'),
    ).resolves.toBeNull();
    await expect(
      readServicePrincipal(fakeSql(null), 'mia'),
    ).resolves.toBeNull();
  });
});
