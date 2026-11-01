// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { patchGroup, patchUser } = vi.hoisted(() => ({
  patchGroup: vi.fn(async (_sql: unknown, _args: unknown) => null),
  patchUser: vi.fn(async (_sql: unknown, _args: unknown) => null),
}));

vi.mock('./service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./service.ts')>()),
  patchGroup,
  patchUser,
}));

import { scimShimHandlers } from './shim.ts';

/**
 * The shim parses what the reused dispatcher bodies hand the data layer, and
 * zod drops every key a schema does not name: an `externalId` a Group PATCH
 * sent never reached `patchGroup` (#4773). The service is a double here; what
 * it does with the value is `service.test.ts`'s.
 */
describe('scimShimHandlers — a PATCH write keeps its externalId', () => {
  const handlers = scimShimHandlers({} as never);

  beforeEach(() => {
    patchGroup.mockClear();
    patchUser.mockClear();
  });

  it('hands patchGroup the externalId', async () => {
    const handler = handlers['scim/internal_mutations:patchGroup'];
    if (handler === undefined) throw new Error('patchGroup shim missing');

    await handler({
      organizationId: 'org-1',
      teamId: 't-1',
      memberOperations: [],
      externalId: 'idp-g',
    });

    expect(patchGroup.mock.calls[0]?.[1]).toMatchObject({
      teamId: 't-1',
      externalId: 'idp-g',
    });
  });

  it('hands patchUser the externalId', async () => {
    const handler = handlers['scim/internal_mutations:patchUser'];
    if (handler === undefined) throw new Error('patchUser shim missing');

    await handler({
      organizationId: 'org-1',
      userId: 'u-1',
      defaultRole: 'member',
      externalId: 'idp-u',
    });

    expect(patchUser.mock.calls[0]?.[1]).toMatchObject({
      userId: 'u-1',
      externalId: 'idp-u',
    });
  });
});

/**
 * A Group PATCH's member operations apply one at a time, in the order they
 * were sent (#4774), so the shim hands them on whole and in that order.
 */
describe('scimShimHandlers — a Group PATCH keeps the order of its member operations [SCIM-R10]', () => {
  const handlers = scimShimHandlers({} as never);

  beforeEach(() => {
    patchGroup.mockClear();
  });

  it('hands patchGroup the member operations in the order they were sent', async () => {
    const handler = handlers['scim/internal_mutations:patchGroup'];
    if (handler === undefined) throw new Error('patchGroup shim missing');
    const memberOperations = [
      { op: 'add', memberIds: ['u-3'] },
      { op: 'replace', memberIds: [] },
      { op: 'remove', memberIds: ['u-1'] },
    ];

    await handler({ organizationId: 'org-1', teamId: 't-1', memberOperations });

    expect(patchGroup.mock.calls[0]?.[1]).toMatchObject({ memberOperations });
  });
});
