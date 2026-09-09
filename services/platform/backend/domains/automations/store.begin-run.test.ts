// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { addJobInTx } from '../../jobs/enqueue.ts';
import { beginRun } from './store.ts';

function fakeStore(deployed: number | undefined = 1, projects: string[] = []) {
  const writes: unknown[][] = [];
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM app.automation_deployments')) {
      return deployed === undefined ? [] : [{ version: deployed }];
    }
    if (text.includes('FROM app.automations')) {
      return [
        {
          document: {
            inputs: {
              $id: 'https://tale.test/run-input',
              type: 'object',
              required: ['orderId'],
              properties: { orderId: { type: 'string' } },
            },
          },
        },
      ];
    }
    if (text.includes('FROM app.automation_project_bindings')) {
      return projects.map((projectId) => ({ projectId }));
    }
    if (text.includes('FROM app.projects')) return [{ id: 'p-1' }];
    if (text.includes('INSERT INTO app.automation_runs')) {
      writes.push(values);
      return [{ id: 'run-1' }];
    }
    return [];
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    begin: (callback: (tx: typeof tag) => Promise<unknown>) => callback(tag),
  }) as unknown as Sql;
  return { sql, writes };
}

const args = {
  organizationId: 'org-1',
  name: 'orders/process',
  startedBy: 'user-1',
  mode: 'live' as const,
  input: { orderId: 'order-1' },
};

beforeEach(() => vi.clearAllMocks());

describe('durable run admission', () => {
  it('refuses a saved but undeployed live version before enqueuing work', async () => {
    const { sql, writes } = fakeStore();
    await expect(beginRun(sql, { ...args, version: 2 })).rejects.toMatchObject({
      code: 'AUTOMATION_VERSION_NOT_DEPLOYED',
      status: 409,
    });
    expect(writes).toHaveLength(0);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it.each([{}, 'wrong', { orderId: 9 }])(
    'refuses invalid input %j before any run or job exists',
    async (input) => {
      const { sql, writes } = fakeStore();
      await expect(beginRun(sql, { ...args, input })).rejects.toMatchObject({
        code: 'AUTOMATION_INPUT_INVALID',
        status: 400,
      });
      expect(writes).toHaveLength(0);
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );

  it('starts the deployed live version and accepts repeated schema ids', async () => {
    const { sql, writes } = fakeStore();
    await expect(beginRun(sql, args)).resolves.toEqual({
      runId: 'run-1',
      version: 1,
    });
    await expect(beginRun(sql, args)).resolves.toEqual({
      runId: 'run-1',
      version: 1,
    });
    expect(writes).toHaveLength(2);
    expect(addJobInTx).toHaveBeenCalledTimes(2);
  });

  it('allows an explicitly saved version in mock mode', async () => {
    const { sql } = fakeStore();
    await expect(
      beginRun(sql, { ...args, mode: 'mock', version: 2 }),
    ).resolves.toEqual({
      runId: 'run-1',
      version: 2,
    });
  });

  it.each([['p-1'], ['p-1', 'p-2']])(
    'refuses org execution when bindings would infer or hide a project: %j',
    async (...projects) => {
      const { sql, writes } = fakeStore(1, projects);
      await expect(
        beginRun(sql, { ...args, requireOrgScope: true }),
      ).rejects.toMatchObject({
        code: 'AUTOMATION_PROJECT_SCOPE_REQUIRED',
        status: 409,
      });
      expect(writes).toHaveLength(0);
      expect(addJobInTx).not.toHaveBeenCalled();
    },
  );

  it('keeps a new org run unscoped when the automation is not installed in a project', async () => {
    const { sql, writes } = fakeStore();
    await beginRun(sql, { ...args, requireOrgScope: true });
    expect(writes[0]?.[3]).toBeNull();
  });

  it('preserves the explicit project scope supplied by an authorized task or REST door', async () => {
    const { sql, writes } = fakeStore(1, ['p-1']);
    await beginRun(sql, { ...args, projectId: 'p-1' });
    expect(writes[0]?.[3]).toBe('p-1');
  });
});
