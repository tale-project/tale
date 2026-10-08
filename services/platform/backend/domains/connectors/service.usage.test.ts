// @vitest-environment node

/**
 * Whose connector call a live call that ran is counted as: the spender its
 * caller names — an agent's turn names its run — else an automation step's
 * run, else the member who made it. The platform's own sends name nobody
 * and are not counted. Every count is a connector call at no cost, never a
 * model request.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConnectorCaller,
  ExecuteConnectorActionArgs,
} from '../../../lib/connectors/dispatcher.ts';
import { recordConnectorUsage } from '../governance/service.ts';
import { resolveAutomationRunAttribution } from '../sandbox/op-attribution.ts';
import { runConnectorAction } from './service.ts';

vi.mock('../../../lib/connectors/dispatcher.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../lib/connectors/dispatcher.ts')
  >()),
  loadConnectorCatalog: vi.fn(),
  // The body "ran": the door's usage sink hears about it, as the real
  // dispatcher tells it once a live body was reached.
  executeConnectorAction: vi.fn(async (args: ExecuteConnectorActionArgs) => {
    await args.ctx.usage?.record({
      organizationId: args.ctx.organizationId,
      connector: args.connector,
      action: args.action,
      caller: args.caller,
      outcome: 'ok',
    });
    return {
      status: 'ok',
      connector: args.connector,
      action: args.action,
      nodeType: `${args.connector}.${args.action}`,
      mode: 'live',
      backend: 'yaml-js',
      effects: 'read',
      output: null,
    };
  }),
}));
vi.mock('../governance/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../governance/service.ts')>()),
  recordConnectorUsage: vi.fn(async () => undefined),
}));
vi.mock('../sandbox/op-attribution.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../sandbox/op-attribution.ts')>()),
  resolveAutomationRunAttribution: vi.fn(),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the door's own SQL is never reached: every collaborator is mocked
const sql = (() => Promise.resolve([])) as unknown as Sql;

function call(caller: ConnectorCaller, extra: Record<string, unknown> = {}) {
  return runConnectorAction(sql, {
    organizationId: 'org_1',
    connector: 'gmail',
    action: 'list_messages',
    input: {},
    mode: 'live',
    caller,
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a live connector call, counted', () => {
  it('books an automation step to its run’s subject: person, automation, key, projects [GOV-R15]', async () => {
    vi.mocked(resolveAutomationRunAttribution).mockResolvedValueOnce({
      userId: 'mia',
      agentSlug: 'invoices/monthly',
      apiKeyId: 'key_1',
      projectIds: ['project_1'],
    });

    await call({ kind: 'workflow', runId: 'run_1', nodeId: 'n1' });

    expect(resolveAutomationRunAttribution).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      runId: 'run_1',
    });
    expect(recordConnectorUsage).toHaveBeenCalledWith(sql, {
      organizationId: 'org_1',
      userId: 'mia',
      agentSlug: 'invoices/monthly',
      apiKeyId: 'key_1',
      projectIds: ['project_1'],
      connectorName: 'gmail',
      connectorOperation: 'list_messages',
      costEstimateCents: 0,
      timestamp: expect.any(Number),
    });
  });

  it('books a step of a run that is gone to automations', async () => {
    vi.mocked(resolveAutomationRunAttribution).mockResolvedValueOnce(null);

    await call({ kind: 'workflow', runId: 'run_gone', nodeId: 'n1' });

    expect(recordConnectorUsage).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ userId: '__automation__' }),
    );
  });

  it('books a member’s call to them, and an agent’s to the run its turn names', async () => {
    await call({ kind: 'user', userId: 'noah' });
    await call(
      { kind: 'user', userId: 'noah' },
      {
        spender: {
          userId: 'noah',
          agentSlug: 'agent_7',
          projectIds: ['project_2'],
        },
      },
    );

    expect(
      vi.mocked(recordConnectorUsage).mock.calls.map(([, row]) => row),
    ).toEqual([
      expect.objectContaining({ userId: 'noah' }),
      expect.objectContaining({
        userId: 'noah',
        agentSlug: 'agent_7',
        projectIds: ['project_2'],
      }),
    ]);
    expect(
      vi.mocked(recordConnectorUsage).mock.calls[0]?.[1],
    ).not.toHaveProperty('agentSlug');
  });

  it('counts the platform’s own send for nobody, and an Inbox send for its sender', async () => {
    await call({ kind: 'system', reason: 'notification email' });
    expect(recordConnectorUsage).not.toHaveBeenCalled();

    await call(
      { kind: 'system', reason: 'conversation email reply' },
      { spender: { userId: 'mia' } },
    );
    expect(recordConnectorUsage).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ userId: 'mia', connectorName: 'gmail' }),
    );
  });
});
