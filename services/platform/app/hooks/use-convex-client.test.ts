import { describe, expect, it, vi } from 'vitest';

import { makeAdapterAwareClient } from './use-convex-client';

const { convexQuery, convexAction, convexMutation, readRow, writeRun } =
  vi.hoisted(() => ({
    convexQuery: vi.fn(() => Promise.resolve('convex-query')),
    convexAction: vi.fn(() => Promise.resolve('convex-action')),
    convexMutation: vi.fn(() => Promise.resolve('convex-mutation')),
    readRow: vi.fn(() => ({
      queryKey: ['backend', 'org-1', 'thing'],
      queryFn: () => Promise.resolve('adapted-read'),
    })),
    writeRun: vi.fn(() => Promise.resolve('adapted-write')),
  }));

vi.mock('@/app/lib/backend/convex-adapters', () => ({
  READ_ADAPTERS: { 'things/queries:getThing': readRow },
  WRITE_ADAPTERS: { 'things/mutations:setThing': { run: writeRun } },
  ACTION_QUERY_ADAPTERS: {},
  activeOrganizationId: () => 'org-1',
  runAdapted: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('convex/server', () => ({
  getFunctionName: (fn: { name: string }) => fn.name,
}));

vi.mock('convex/react', () => ({ useConvex: () => ({}) }));

const client = makeAdapterAwareClient({
  query: convexQuery,
  action: convexAction,
  mutation: convexMutation,
} as never);

// Plain refs mirroring convex/server's getFunctionName contract.
const ref = (name: string): never => ({ name }) as never;

describe('makeAdapterAwareClient (imperative seam)', () => {
  it('serves a migrated query over the adapted HTTP lane', async () => {
    await expect(
      client.query(ref('things/queries:getThing'), {} as never),
    ).resolves.toBe('adapted-read');
    expect(convexQuery).not.toHaveBeenCalled();
  });

  it('passes an unmigrated query through to the Convex client', async () => {
    await expect(
      client.query(ref('things/queries:other'), {} as never),
    ).resolves.toBe('convex-query');
    expect(convexQuery).toHaveBeenCalledOnce();
  });

  it('serves a migrated mutation through the write adapter', async () => {
    await expect(
      client.mutation(ref('things/mutations:setThing'), {} as never),
    ).resolves.toBe('adapted-write');
    expect(convexMutation).not.toHaveBeenCalled();
    expect(writeRun).toHaveBeenCalledWith({}, { organizationId: 'org-1' });
  });

  it('passes an unmigrated action through to the Convex client', async () => {
    await expect(
      client.action(ref('things/actions:doThing'), {} as never),
    ).resolves.toBe('convex-action');
    expect(convexAction).toHaveBeenCalledOnce();
  });
});
