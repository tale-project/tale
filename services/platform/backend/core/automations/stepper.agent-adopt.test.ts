// @vitest-environment node

/**
 * A kick that crashed after its op row and before the run's cursor leaves a
 * turn in flight with no cursor; the next walk ADOPTS that op instead of
 * kicking a second turn. The REAL walk, with the stepper suites' stand-in
 * world. The adopted cursor must name the harness the op runs on: a step on
 * the default resolves its harness at each kick, and the default the walk
 * would resolve now is not where the turn in flight runs — its settle, a
 * retry's resume and an answered question follow the cursor's harness.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { Automation } from '../../../lib/engine/core/types';
import { DEFAULT_HARNESS } from '../../../lib/shared/harness-offer';
import type { AutomationAgentHost } from './agent_host.ts';
import type { AgentCursor } from './checkpoints.ts';
import { type FakeWorld, fakeStepperWorld } from './stepper.test-helpers.ts';
import { setAutomationAgentHostFactory, stepRunImpl } from './stepper.ts';

type KickArgs = Parameters<AutomationAgentHost['kick']>[0];

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

/** One agent step that names no harness: it runs on the default. */
const DOCUMENT: Automation = {
  version: 1,
  name: 'triage',
  nodes: [
    {
      id: 'triage',
      type: 'agent',
      model: 'anthropic/claude-sonnet',
      prompt: 'Triage the inbox.',
    },
  ],
  output: '{{ nodes.triage.output }}',
};

/** The turn in flight, as the store reads its op row. */
const LIVE_OP = {
  execId: 'exec-live',
  sessionId: 'wf-run-1',
  deadlineAt: Date.now() + 60 * 60_000,
  providerSlug: 'anthropic',
  gatewayModel: 'claude-sonnet',
};

afterEach(() => {
  setAutomationAgentHostFactory(null);
});

/** Install an agent host that records every kick and parks each turn. */
function recordingHost(): KickArgs[] {
  const kicks: KickArgs[] = [];
  setAutomationAgentHostFactory(() => ({
    kick: async (args) => {
      kicks.push(structuredClone(args));
      return {
        execId: 'exec-new',
        sessionId: 'wf-run-1',
        deadlineAt: Date.now() + 60 * 60_000,
        providerSlug: 'anthropic',
        gatewayModel: 'claude-sonnet',
        harness: DEFAULT_HARNESS,
        harnessReason: 'default',
      };
    },
    poll: async () => null,
    cancel: async () => undefined,
  }));
  return kicks;
}

/** The agent turn the run is parked on. */
function parkedTurn(world: FakeWorld): AgentCursor {
  const cursor = world.run.checkpoints.cursor as
    | { agent?: AgentCursor }
    | undefined;
  if (cursor?.agent === undefined) throw new Error('no agent turn is parked');
  return cursor.agent;
}

describe('adopting the turn a crashed kick left in flight', () => {
  it('names the harness the op runs on, not the one the default resolves to now', async () => {
    const kicks = recordingHost();
    // The op names a harness the default does not resolve to (Codex is
    // neither Claude Code nor Pi).
    const opHarness = 'codex';
    expect(opHarness).not.toBe(DEFAULT_HARNESS);
    const world = fakeStepperWorld({
      document: DOCUMENT,
      mode: 'live',
      liveAgentOp: { ...LIVE_OP, harness: opHarness },
    });

    await stepRunImpl(world.ctx, RUN);

    // Adopted, not kicked again: no second turn, no double spend.
    expect(kicks).toHaveLength(0);
    expect(parkedTurn(world)).toMatchObject({
      execId: 'exec-live',
      harness: opHarness,
    });
  });

  it('keeps why the op runs where it runs, as the kick that opened it recorded', async () => {
    recordingHost();
    const world = fakeStepperWorld({
      document: DOCUMENT,
      mode: 'live',
      liveAgentOp: {
        ...LIVE_OP,
        harness: 'claude-code',
        harnessReason: 'subscription_bound',
      },
    });

    await stepRunImpl(world.ctx, RUN);

    // An answered question's resume of this turn records the same reason.
    expect(parkedTurn(world)).toMatchObject({
      harness: 'claude-code',
      harnessReason: 'subscription_bound',
    });
  });

  it('falls back to the step’s harness for an op written before ops recorded theirs', async () => {
    const kicks = recordingHost();
    const world = fakeStepperWorld({
      document: DOCUMENT,
      mode: 'live',
      liveAgentOp: LIVE_OP,
    });

    await stepRunImpl(world.ctx, RUN);

    expect(kicks).toHaveLength(0);
    expect(parkedTurn(world)).toMatchObject({
      execId: 'exec-live',
      harness: DEFAULT_HARNESS,
    });
    expect(parkedTurn(world)).not.toHaveProperty('harnessReason');
  });
});

describe('the turn a kick parks the run on', () => {
  it('keeps why the kick put it on its harness, for the conversation’s later turns', async () => {
    const kicks = recordingHost();
    const world = fakeStepperWorld({ document: DOCUMENT, mode: 'live' });

    await stepRunImpl(world.ctx, RUN);

    expect(kicks).toHaveLength(1);
    expect(parkedTurn(world)).toMatchObject({
      execId: 'exec-new',
      harness: DEFAULT_HARNESS,
      harnessReason: 'default',
    });
  });
});
