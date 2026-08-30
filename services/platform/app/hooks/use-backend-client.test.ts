import { describe, expect, it, vi } from 'vitest';

import type {
  MutationName,
  QueryName,
  ActionName,
} from '@/app/lib/backend/contract';

import { makeAdapterAwareClient } from './use-backend-client';

const { readRow, writeRun, writeInvalidate } = vi.hoisted(() => ({
  readRow: vi.fn(() => ({
    queryKey: ['backend', 'org-1', 'thing'],
    queryFn: () => Promise.resolve('adapted-read'),
  })),
  writeRun: vi.fn(() => Promise.resolve('adapted-write')),
  writeInvalidate: vi.fn(),
}));

// A registry with exactly two rows: these tests cover the imperative seam's
// own wiring, not any shipped row.
vi.mock('@/app/lib/backend/adapters', () => ({
  READ_ADAPTERS: { 'things/queries:getThing': readRow },
  WRITE_ADAPTERS: {
    'things/mutations:setThing': {
      run: writeRun,
      invalidate: writeInvalidate,
    },
  },
  ACTION_QUERY_ADAPTERS: {},
  activeOrganizationId: () => 'org-1',
  runAdapted: async (fn: () => Promise<unknown>) => fn(),
}));

const queryClient = { invalidateQueries: vi.fn() };
const client = makeAdapterAwareClient(queryClient as never);

/** The stub rows above are not shipped contract entries — that is the point. */
const READ = 'things/queries:getThing' as QueryName;
const WRITE = 'things/mutations:setThing' as MutationName;
const MISSING_READ = 'things/queries:other' as QueryName;
const MISSING_ACTION = 'things/actions:doThing' as ActionName;

describe('makeAdapterAwareClient (imperative seam)', () => {
  it('serves a read over its adapter row', async () => {
    await expect(client.query(READ, {} as never)).resolves.toBe('adapted-read');
  });

  it('serves a write over its adapter row, org-scoped', async () => {
    await expect(client.mutation(WRITE, {} as never)).resolves.toBe(
      'adapted-write',
    );
    expect(writeRun).toHaveBeenCalledWith({}, { organizationId: 'org-1' });
    expect(writeInvalidate).toHaveBeenCalledWith(
      queryClient,
      {},
      { organizationId: 'org-1' },
    );
  });

  it('invalidates after a successful action the same way the hook twin does', async () => {
    writeInvalidate.mockClear();
    await expect(
      client.action(WRITE, { name: 'probe' } as never),
    ).resolves.toBe('adapted-write');
    expect(writeInvalidate).toHaveBeenCalledWith(
      queryClient,
      { name: 'probe' },
      { organizationId: 'org-1' },
    );
  });

  it('does not invalidate when the write throws', async () => {
    writeRun.mockRejectedValueOnce(new Error('refused'));
    writeInvalidate.mockClear();
    await expect(client.mutation(WRITE, {} as never)).rejects.toThrow(
      'refused',
    );
    expect(writeInvalidate).not.toHaveBeenCalled();
  });

  it('refuses a read with no row, NAMING it', async () => {
    await expect(client.query(MISSING_READ, {} as never)).rejects.toThrow(
      'things/queries:other',
    );
  });

  it('refuses an action with no row, NAMING it', async () => {
    await expect(client.action(MISSING_ACTION, {} as never)).rejects.toThrow(
      'things/actions:doThing',
    );
  });
});
