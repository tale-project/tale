/**
 * Which runner a live call gets, and what its host may touch: the connectors
 * door decides both before the dispatcher runs. The dispatcher is replaced so
 * the test reads exactly what the door hands it.
 */
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeConnectorAction } = vi.hoisted(() => ({
  executeConnectorAction: vi.fn(),
}));

vi.mock('../../../lib/connectors/dispatcher.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../lib/connectors/dispatcher.ts')
  >()),
  executeConnectorAction,
}));

import { IN_PROCESS_LIVE_RUNNER_KIND } from '../../../lib/connectors/in-process-live.ts';
import { runConnectorAction } from './service.ts';

// The host assembly only builds closures over the client; nothing queries.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in no call reaches
const sql = {} as Sql;

const handed = () => {
  const args: unknown = executeConnectorAction.mock.calls[0]?.[0];
  if (typeof args !== 'object' || args === null || !('ctx' in args)) {
    throw new Error('the door handed the dispatcher no context');
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shape checked above; the test reads its fields
  return args.ctx as Record<string, unknown> & {
    codeRunner?: { kind(): string };
  };
};

describe('runConnectorAction — the runner a live call gets', () => {
  beforeEach(() => {
    executeConnectorAction.mockReset();
    executeConnectorAction.mockResolvedValue({ status: 'ok', output: {} });
  });

  it('runs a live body on the in-process runner with no sandbox in the path [CONN-R13]', async () => {
    await runConnectorAction(sql, {
      organizationId: 'org_1',
      connector: 'tavily',
      action: 'search',
      input: { query: 'tale' },
      mode: 'live',
      caller: { kind: 'user', userId: 'user_1' },
    });

    const ctx = handed();
    expect(ctx.codeRunner?.kind()).toBe(IN_PROCESS_LIVE_RUNNER_KIND);
    expect(ctx).not.toHaveProperty('portableHost');
    expect(ctx).toHaveProperty('blobs');
  });

  it('gives an agent bridge call no file store [CONN-R14]', async () => {
    await runConnectorAction(sql, {
      organizationId: 'org_1',
      connector: 'gmail',
      action: 'get_attachments',
      input: {},
      mode: 'live',
      caller: { kind: 'user', userId: 'user_1' },
      storeFiles: false,
    });

    const ctx = handed();
    expect(ctx.codeRunner?.kind()).toBe(IN_PROCESS_LIVE_RUNNER_KIND);
    expect(ctx).not.toHaveProperty('blobs');
  });
});
