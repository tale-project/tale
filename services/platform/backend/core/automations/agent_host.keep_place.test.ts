// @vitest-environment node

/**
 * A node's start the sandbox host refused with a place in its first-come
 * line keeps that place while the node's next start waits for one of the
 * platform's start slots (#5224). The spawner drops a waiter it has not
 * heard from within twice its hint and 15 s, 25 s at the front of the line,
 * and under load a start slot takes longer than that to take the re-kick's
 * job: the run lost its place to every create that asked meanwhile. The host
 * now renews the place every few seconds from a queue no start slot holds,
 * for as long as the run waits on that node's start.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs.ts';
import type { ActionCtx } from '../lib/ctx.ts';
import {
  renewSessionPlace,
  ROOM_PLACE_RENEW_MS,
} from '../node_only/sandbox/helpers/session_client.ts';
import {
  keepWorkflowAgentPlaceImpl,
  workflowPlaceWanted,
} from './agent_host.ts';
import type { AgentCursor } from './checkpoints.ts';

vi.mock(
  '../node_only/sandbox/helpers/session_client.ts',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../node_only/sandbox/helpers/session_client.ts')
    >()),
    renewSessionPlace: vi.fn(),
  }),
);

const PLACE = {
  organizationId: 'org_1',
  runId: 'run_1',
  nodeId: 'draft',
  sessionId: 'wf-run_1',
};

/** How long the spawner keeps a waiter at the front of its line that it
 * does not hear from: twice its 5 s hint and 15 s
 * (`services/sandbox/src/session/session-routes.ts`). */
const FRONT_WINDOW_MS = 2 * 5_000 + 15_000;

function agent(overrides: Partial<AgentCursor> = {}): AgentCursor {
  return {
    execId: 'exec_2',
    sessionId: PLACE.sessionId,
    deadlineAt: Date.now() + 60_000,
    providerSlug: 'anthropic',
    gatewayModel: 'claude',
    harness: 'claude-code',
    input: {},
    ...overrides,
  };
}

/** The node's last start, settled as refused for want of sandbox room. */
function refused(extra: { failureCode?: string; roomQueued?: true } = {}) {
  return agent({
    execId: 'exec_1',
    result: {
      errored: true,
      failureCode: 'sandbox_capacity',
      text: '',
      files: [],
      ...extra,
    },
  });
}

const inLine = refused({ roomQueued: true });

describe('workflowPlaceWanted', () => {
  it.each([
    ['its last start was refused with a place in line', 'waiting', inLine],
    ['the re-kick’s start has not asked yet', 'running', agent()],
    ['the re-kick’s start has not asked yet, parked', 'waiting', agent()],
  ])('is wanted while %s', (_, status, parked) => {
    expect(
      workflowPlaceWanted(
        { status, cursor: { node: 'draft', agent: parked } },
        'draft',
      ),
    ).toBe(true);
  });

  it.each([
    ['the run is gone', null],
    [
      'the run ended',
      { status: 'cancelled', cursor: { node: 'draft', agent: inLine } },
    ],
    ['the run moved on', { status: 'running', cursor: { node: 'send' } }],
    [
      'the cursor is on the node without an agent',
      { status: 'running', cursor: { node: 'draft' } },
    ],
    [
      'the node’s turn finished',
      {
        status: 'running',
        cursor: {
          node: 'draft',
          agent: agent({ result: { errored: false, text: 'x', files: [] } }),
        },
      },
    ],
    [
      'the refusal named no place in line',
      { status: 'waiting', cursor: { node: 'draft', agent: refused() } },
    ],
    [
      'the start was refused for something else',
      {
        status: 'waiting',
        cursor: {
          node: 'draft',
          agent: refused({ failureCode: 'model_capacity', roomQueued: true }),
        },
      },
    ],
  ])('is not wanted once %s', (_, state) => {
    expect(workflowPlaceWanted(state, 'draft')).toBe(false);
  });
});

describe('keepWorkflowAgentPlaceImpl', () => {
  const AT = Date.parse('2026-11-01T09:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AT);
    vi.mocked(renewSessionPlace).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** A host ctx whose run reads `state()`, recording each hop it queues. */
  function hostCtx(state: () => unknown) {
    const hops: Array<{ name: string; at: number; args: unknown }> = [];
    const reads: unknown[] = [];
    const ctx = {
      runQuery: async (ref: unknown, args: unknown) => {
        const name = functionRefName(ref);
        if (name !== 'automations/queries:readAgentCursor') {
          throw new Error(`unexpected query ${name}`);
        }
        reads.push(args);
        return state();
      },
      runMutation: async (ref: unknown) => {
        throw new Error(`unexpected mutation ${functionRefName(ref)}`);
      },
      runAction: async (ref: unknown) => {
        throw new Error(`unexpected action ${functionRefName(ref)}`);
      },
      scheduler: {
        runAfter: async (delay: number, ref: unknown, args: unknown) => {
          hops.push({
            name: functionRefName(ref),
            at: Date.now() + delay,
            args,
          });
          return 'job';
        },
      },
    } as unknown as ActionCtx;
    return { ctx, hops, reads };
  }

  const waiting = {
    status: 'waiting',
    cursor: { node: 'draft', agent: inLine },
  };

  it('renews the place while the run waits on the node, and queues the next renewal', async () => {
    vi.mocked(renewSessionPlace).mockResolvedValue(true);
    const host = hostCtx(() => waiting);

    // The hop carries only the place, whatever else its caller held.
    await keepWorkflowAgentPlaceImpl(host.ctx, {
      ...PLACE,
      execId: 'exec_1',
    } as never);

    expect(host.reads).toEqual([{ organizationId: 'org_1', runId: 'run_1' }]);
    expect(renewSessionPlace).toHaveBeenCalledWith('wf-run_1');
    expect(host.hops).toEqual([
      {
        name: 'automations/agent_host:keepWorkflowAgentPlace',
        at: AT + ROOM_PLACE_RENEW_MS,
        args: PLACE,
      },
    ]);
  });

  it('renews nothing once the run no longer waits on the node', async () => {
    const host = hostCtx(() => ({
      status: 'running',
      cursor: { node: 'send' },
    }));

    await keepWorkflowAgentPlaceImpl(host.ctx, PLACE);

    expect(renewSessionPlace).not.toHaveBeenCalled();
    expect(host.hops).toEqual([]);
  });

  it('stops once the spawner no longer keeps the place', async () => {
    // Admitted, destroyed or dropped: a renewal never puts a waiter back.
    vi.mocked(renewSessionPlace).mockResolvedValue(false);
    const host = hostCtx(() => waiting);

    await keepWorkflowAgentPlaceImpl(host.ctx, PLACE);

    expect(renewSessionPlace).toHaveBeenCalledTimes(1);
    expect(host.hops).toEqual([]);
  });

  it('keeps renewing after a renewal that failed', async () => {
    vi.mocked(renewSessionPlace).mockRejectedValue(new Error('spawner down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = hostCtx(() => waiting);

    await keepWorkflowAgentPlaceImpl(host.ctx, PLACE);

    expect(warn).toHaveBeenCalledWith(
      "[agent-host] renewing the place of run run_1 in its sandbox host's line failed:",
      expect.any(Error),
    );
    expect(host.hops.map((hop) => hop.at)).toEqual([AT + ROOM_PLACE_RENEW_MS]);
  });

  it('keeps the front of the line for a re-kick held three minutes behind busy start slots, and lets it go once the start launched', async () => {
    // The refusal at AT named the front place and queued the first renewal
    // (the start's catch); the stepper re-kicks the node 20 s later, and a
    // start slot takes the re-kick's job only three minutes after that.
    const reKickedAt = AT + 20_000;
    const launchedAt = AT + 3 * 60_000;
    const renewedAt: number[] = [];
    vi.mocked(renewSessionPlace).mockImplementation(async () => {
      renewedAt.push(Date.now());
      // From its launch on the spawner no longer keeps the start in line.
      return Date.now() < launchedAt;
    });
    const host = hostCtx(() =>
      Date.now() < reKickedAt
        ? waiting
        : { status: 'waiting', cursor: { node: 'draft', agent: agent() } },
    );
    host.hops.push({
      name: 'automations/agent_host:keepWorkflowAgentPlace',
      at: AT + ROOM_PLACE_RENEW_MS,
      args: PLACE,
    });

    // Each renewal runs when its job comes due, taken a poll later.
    for (
      let hop = host.hops.shift();
      hop !== undefined;
      hop = host.hops.shift()
    ) {
      vi.setSystemTime(hop.at + 2_000);
      await keepWorkflowAgentPlaceImpl(host.ctx, PLACE);
    }

    const heard = [
      AT,
      ...renewedAt.filter((at) => at < launchedAt),
      launchedAt,
    ];
    const silences = heard
      .slice(1)
      .map((at, index) => at - (heard[index] ?? at));
    expect(Math.max(...silences)).toBeLessThan(FRONT_WINDOW_MS);
    // One renewal after the launch learns the place is gone, and the chain
    // ends.
    expect(renewedAt.filter((at) => at >= launchedAt)).toHaveLength(1);
  });
});
