// @vitest-environment node

/**
 * An agent step hands its agent what the node resolved, its `input`
 * included, in a live run as in a test run. The REAL walk, with the stepper
 * suites' stand-in world and a recording agent host: the in-process
 * executor always passed the input on, while the durable lane dropped it, so
 * a test run honoured an agent's input and a live run silently ignored it.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { execute } from '../../../lib/engine/core/execute';
import { unitKeyOf } from '../../../lib/engine/core/record/recorder';
import { setCodeRunner } from '../../../lib/engine/core/runner';
import type { Automation } from '../../../lib/engine/core/types';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm';
import type { AutomationAgentHost } from './agent_host.ts';
import type { AgentCursor } from './checkpoints.ts';
import { type FakeWorld, fakeStepperWorld } from './stepper.test-helpers.ts';
import { setAutomationAgentHostFactory, stepRunImpl } from './stepper.ts';

type KickArgs = Parameters<AutomationAgentHost['kick']>[0];

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

/** An agent step whose input reads the run's input and an earlier step. */
const DOCUMENT: Automation = {
  version: 1,
  name: 'onboarding-brief',
  nodes: [
    {
      id: 'account',
      type: 'transform',
      code: "return { plan: 'gold', seats: 12 };",
    },
    {
      id: 'brief',
      type: 'agent',
      model: 'anthropic/claude-sonnet',
      prompt: 'Write the onboarding brief for {{ input.customer }}.',
      input: {
        customer: '{{ input.customer }}',
        account: '{{ nodes.account.output }}',
        apiKey: '{{ input.apiKey }}',
      },
    },
  ],
  output: '{{ nodes.brief.output }}',
};

const RUN_INPUT = { customer: 'Ada Lovelace', apiKey: 'k-0000' };

/** What the step's `input` resolves to for {@link RUN_INPUT}. */
const RESOLVED = {
  customer: 'Ada Lovelace',
  account: { plan: 'gold', seats: 12 },
  apiKey: 'k-0000',
};

/** The same, as a run's record and trace keep it: the secret withheld. */
const WITHHELD = { ...RESOLVED, apiKey: null };

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

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
        execId: `exec-${kicks.length}`,
        sessionId: 'wf-run-1',
        deadlineAt: Date.now() + 60 * 60_000,
        providerSlug: 'anthropic',
        gatewayModel: 'claude-sonnet',
        harness: 'claude-code',
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

/** Step the run once more, the way the queue does after a park. */
async function stepAgain(world: FakeWorld): Promise<void> {
  world.run.status = 'running';
  await stepRunImpl(world.ctx, RUN);
}

describe('the input of a live agent step', () => {
  it('reaches the agent host with the rest of the resolved request', async () => {
    const kicks = recordingHost();
    const world = fakeStepperWorld({
      document: DOCUMENT,
      mode: 'live',
      input: RUN_INPUT,
    });

    await stepRunImpl(world.ctx, RUN);

    expect(kicks).toHaveLength(1);
    expect(kicks[0]?.request).toEqual({
      model: 'anthropic/claude-sonnet',
      prompt: 'Write the onboarding brief for Ada Lovelace.',
      input: RESOLVED,
    });
    // The park keeps the request, so the settle and a retry see the same one.
    expect(parkedTurn(world).input).toEqual(kicks[0]?.request);
  });

  it("is in the step's record, its secrets withheld", async () => {
    recordingHost();
    const world = fakeStepperWorld({
      document: DOCUMENT,
      mode: 'live',
      input: RUN_INPUT,
    });

    await stepRunImpl(world.ctx, RUN);

    const record = world.nodeRuns.get(
      unitKeyOf({ path: 'brief', item: -1, pass: -1 }),
    );
    expect(record?.input?.value).toMatchObject({ input: WITHHELD });
  });

  it('is in the trace and the effect once the turn settles', async () => {
    recordingHost();
    const world = fakeStepperWorld({
      document: DOCUMENT,
      mode: 'live',
      input: RUN_INPUT,
    });
    await stepRunImpl(world.ctx, RUN);
    parkedTurn(world).result = {
      errored: false,
      text: 'Brief written.',
      files: [],
    };

    await stepAgain(world);

    expect(world.finished).toHaveLength(1);
    const finished = world.finished[0] as {
      status: string;
      trace: Array<{ node: string; input?: unknown }>;
      effects: Array<{ node: string; input?: unknown }>;
    };
    expect(finished.status).toBe('success');
    expect(finished.trace.find((entry) => entry.node === 'brief')).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({ input: WITHHELD }),
      }),
    );
    expect(finished.effects.find((effect) => effect.node === 'brief')).toEqual(
      expect.objectContaining({
        input: expect.objectContaining({ input: RESOLVED }),
      }),
    );
  });

  it('reaches the agent host again when a failed attempt is retried', async () => {
    const kicks = recordingHost();
    const world = fakeStepperWorld({
      document: DOCUMENT,
      mode: 'live',
      input: RUN_INPUT,
    });
    await stepRunImpl(world.ctx, RUN);
    parkedTurn(world).result = {
      errored: true,
      reason: 'the harness crashed',
      failureCode: 'turn_crashed',
      text: '',
      files: [],
    };

    await stepAgain(world);

    expect(kicks).toHaveLength(2);
    expect(kicks[1]?.request.input).toEqual(RESOLVED);
  });
});

describe('the input of an agent step in a test run', () => {
  it('is what the in-process executor hands its agent', async () => {
    const world = fakeStepperWorld({
      document: DOCUMENT,
      mode: 'mock',
      input: RUN_INPUT,
    });

    await stepRunImpl(world.ctx, RUN);

    const inProcess = await execute(DOCUMENT, { input: RUN_INPUT });
    expect(world.finished[0]).toMatchObject({ status: 'success' });
    expect((world.finished[0] as { effects: unknown[] }).effects).toEqual(
      inProcess.effects,
    );
    expect(
      inProcess.effects.find((effect) => effect.node === 'brief')?.input,
    ).toMatchObject({ input: RESOLVED });
  });
});
