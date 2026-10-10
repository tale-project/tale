// @vitest-environment node

/**
 * A connector step of an automation run acts as that run: the events a
 * native raises while it runs — a task the `task` connector creates, a
 * message the mailbox sync files — name the run as their origin
 * (`events/origin.ts`), so the event triggers can keep the run's own
 * automation from starting again. Any other caller acts as the platform.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { currentEventOrigin } from '../events/origin.ts';

const { executeConnectorAction } = vi.hoisted(() => ({
  executeConnectorAction: vi.fn(),
}));

vi.mock('../../../lib/connectors/dispatcher.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../lib/connectors/dispatcher.ts')
  >()),
  executeConnectorAction,
  loadConnectorCatalog: vi.fn(),
}));
vi.mock('../../../lib/connectors/natives/index.ts', () => ({
  registerNativeConnectors: vi.fn(),
}));

const { runConnectorAction } = await import('./service.ts');

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the door only hands sql to seams this test never reaches
const sql = {} as Sql;

describe('runConnectorAction — the origin of the events a call raises', () => {
  let seen: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    seen = undefined;
    executeConnectorAction.mockImplementation(async () => {
      await Promise.resolve();
      seen = currentEventOrigin();
      return { status: 'ok', output: {}, effects: 'none' };
    });
  });

  it('acts as the run for a workflow step [AUTO-R12]', async () => {
    await runConnectorAction(sql, {
      organizationId: 'org-1',
      connector: 'task',
      action: 'comment',
      input: {},
      mode: 'live',
      caller: { kind: 'workflow', runId: 'run-1', nodeId: 'note' },
    });
    expect(seen).toEqual({ kind: 'automation', runId: 'run-1' });
    expect(currentEventOrigin()).toEqual({ kind: 'platform' });
  });

  it.each([
    { kind: 'user' as const, userId: 'u-1' },
    { kind: 'system' as const, reason: 'conversation_reply' },
  ])('acts as the platform for a $kind caller', async (caller) => {
    await runConnectorAction(sql, {
      organizationId: 'org-1',
      connector: 'task',
      action: 'comment',
      input: {},
      mode: 'live',
      caller,
    });
    expect(seen).toEqual({ kind: 'platform' });
  });
});
