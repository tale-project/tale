import { beforeEach, describe, expect, it, vi } from 'vitest';

import { execute } from '../core/execute';
import { dispatch, type DispatchStore } from './dispatch';
import { DOC_EXAMPLE } from './docs';

vi.mock('../core/execute', () => ({ execute: vi.fn() }));

function authorizedStore() {
  const authorizeRun = vi.fn(
    async (_name: string, _mode: 'mock' | 'live') => {},
  );
  const recordRun = vi.fn();
  const store: DispatchStore = {
    list: async () => [],
    get: async () => ({
      meta: { version: 1 },
      automation: DOC_EXAMPLE.automation,
    }),
    deployedVersion: async () => 1,
    save: async () => ({ name: 'order-report', version: 1 }),
    deploy: async () => ({ name: 'order-report', version: 1 }),
    authorizeRun,
    recordRun,
  };
  return { store, authorizeRun, recordRun };
}

beforeEach(() => {
  vi.mocked(execute).mockReset();
  vi.mocked(execute).mockResolvedValue({
    status: 'success',
    trace: [],
    effects: [],
  });
});

describe('in-process deployed run authorization', () => {
  it.each(['mock', 'live'] as const)(
    'refuses %s execution before any node or run record',
    async (mode) => {
      const { store, authorizeRun, recordRun } = authorizedStore();
      authorizeRun.mockRejectedValueOnce(new Error('Project not found.'));
      const response = await dispatch(
        'run_deployed',
        { name: 'order-report', input: {} },
        {
          store,
          ...(mode === 'live'
            ? {
                allowLive: true,
                connectorHost: () => {
                  throw new Error('must not execute');
                },
              }
            : {}),
        },
      );
      expect(response).toEqual({ error: 'Project not found.' });
      expect(authorizeRun).toHaveBeenCalledWith('order-report', mode);
      expect(execute).not.toHaveBeenCalled();
      expect(recordRun).not.toHaveBeenCalled();
    },
  );

  it('authorizes before execution and records the authorized result afterward', async () => {
    const { store, authorizeRun, recordRun } = authorizedStore();
    expect(
      await dispatch(
        'run_deployed',
        { name: 'order-report', input: {} },
        { store },
      ),
    ).toMatchObject({ status: 'success', version: 1 });
    expect(authorizeRun.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(execute).mock.invocationCallOrder[0] ?? 0,
    );
    expect(vi.mocked(execute).mock.invocationCallOrder[0]).toBeLessThan(
      recordRun.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps non-authorizing stores usable for standalone engine tests', async () => {
    const { store } = authorizedStore();
    delete store.authorizeRun;
    expect(
      await dispatch(
        'run_deployed',
        { name: 'order-report', input: {} },
        { store },
      ),
    ).toMatchObject({ status: 'success' });
    expect(execute).toHaveBeenCalledOnce();
  });
});
