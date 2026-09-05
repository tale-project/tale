import { beforeAll, describe, expect, it } from 'vitest';

import { dispatch, type DispatchStore } from '../engine/api/dispatch';
import { DOC_EXAMPLE } from '../engine/api/docs';
import { setCodeRunner } from '../engine/core/slots';
import type { RunResult, Automation } from '../engine/core/types';
import { nodeVmRunner } from '../engine/runners/node-vm';
import { memoryStore } from '../engine/selftest/memory-store';
import { stringifyYaml } from '../shared/config/yaml';
import { CHECKLIST_NUDGE, REFLECTION_NUDGE } from './policy';
import {
  runBuilderSession,
  type BuilderDispatch,
  type BuilderMessage,
  type BuilderModel,
  type BuilderModelRequest,
} from './session';

/**
 * The session policy IS the product here — full history, restart on a
 * fruitless streak, bounded turns, a clean terminal state every time — so
 * these tests drive the loop with a scripted model instead of a real one.
 * Nothing here touches the network or the clock.
 *
 * The happy path and the error-feedback paths run against the REAL dispatch
 * over an in-memory store, so the loop is proven against the actual method
 * table rather than against a mock of it.
 */

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

/** The engine's dispatch bound to a fresh in-memory store. */
function realDispatch(): { dispatch: BuilderDispatch; store: DispatchStore } {
  const mem = memoryStore();
  const store: DispatchStore = {
    list: () => mem.list(),
    get: (name, version) => mem.get(name, version),
    deployedVersion: (name) => mem.deployedVersion(name),
    async save(automation: Automation) {
      const { version } = mem.save(automation.name, automation);
      return { name: automation.name, version };
    },
    async deploy(name: string, version: number) {
      mem.deploy(name, version);
      return { name, version };
    },
  };
  return {
    dispatch: (method, params) => dispatch(method, params, { store }),
    store,
  };
}

/** One agent reply carrying one action, exactly as the protocol asks. */
function reply(method: string, params: unknown): string {
  return `Doing this now.\n\`\`\`yaml\n${stringifyYaml({ method, params })}\`\`\``;
}

type ScriptStep = string | ((request: BuilderModelRequest) => string);

/** A deterministic stand-in for the model: replies in order, and records
 * every conversation it was handed. */
function scriptedModel(script: ScriptStep[]): {
  model: BuilderModel;
  requests: BuilderMessage[][];
} {
  const requests: BuilderMessage[][] = [];
  const model: BuilderModel = async (request) => {
    requests.push(request.messages.map((message) => ({ ...message })));
    const step = script[requests.length - 1] ?? script.at(-1) ?? '';
    return {
      content: typeof step === 'function' ? step(request) : step,
      usage: { prompt: 10, completion: 5 },
    };
  };
  return { model, requests };
}

const GOAL = 'summarize qualifying orders for the sales team';

describe('the happy path: author → validate → test → save', () => {
  it('saves the tested document and ends as succeeded', async () => {
    const engine = realDispatch();
    const { model, requests } = scriptedModel([
      reply('validate_automation', { automation: DOC_EXAMPLE.automation }),
      reply('run_automation', {
        automation: DOC_EXAMPLE.automation,
        input: DOC_EXAMPLE.input,
      }),
      reply('test_automation', { automation: DOC_EXAMPLE.automation }),
      reply('save_automation', {
        automation: DOC_EXAMPLE.automation,
        message: 'first version',
      }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: engine.dispatch,
      model,
    });

    expect(session.outcome).toEqual({
      status: 'succeeded',
      saved: { name: 'order-report', version: 1 },
    });
    expect(session.turns).toBe(4);
    expect(session.restarts).toBe(0);
    expect(session.usage).toEqual({ prompt: 40, completion: 20 });
    expect(requests).toHaveLength(4);
    expect(session.transcript.map((entry) => entry.method)).toEqual([
      'validate_automation',
      'run_automation',
      'test_automation',
      'save_automation',
    ]);
    // The document really landed in the store, at version 1.
    expect(await engine.store.get('order-report')).toMatchObject({
      meta: { version: 1 },
    });
  });

  it('injects the checklist where the agent could think it is done', async () => {
    const engine = realDispatch();
    const { model } = scriptedModel([
      reply('run_automation', {
        automation: DOC_EXAMPLE.automation,
        input: DOC_EXAMPLE.input,
      }),
      reply('test_automation', { automation: DOC_EXAMPLE.automation }),
      reply('save_automation', { automation: DOC_EXAMPLE.automation }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: engine.dispatch,
      model,
    });

    expect(session.outcome.status).toBe('succeeded');
    const nudged = session.messages.filter((message) =>
      message.content.includes(CHECKLIST_NUDGE),
    );
    // Once after the successful run, once after the tests passed.
    expect(nudged).toHaveLength(2);
  });

  it('refuses to save a document whose own tests have not passed', async () => {
    const engine = realDispatch();
    const edited: Automation = {
      ...DOC_EXAMPLE.automation,
      description: 'edited after testing',
    };
    const { model } = scriptedModel([
      reply('save_automation', { automation: DOC_EXAMPLE.automation }),
      reply('test_automation', { automation: DOC_EXAMPLE.automation }),
      reply('save_automation', { automation: edited }),
      reply('save_automation', { automation: DOC_EXAMPLE.automation }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: engine.dispatch,
      model,
    });

    expect(session.outcome.status).toBe('succeeded');
    expect(session.transcript[0].result).toMatchObject({
      error: 'save rejected — this document has not passed its own tests',
    });
    expect(session.transcript[2].result).toMatchObject({
      error:
        'save rejected — the document changed since the last passing test run',
    });
    // Only the tested document was ever handed to the store.
    expect(await engine.store.list()).toEqual([
      { name: 'order-report', latest: 1 },
    ]);
  });
});

describe('malformed replies', () => {
  it('recovers a reply whose JSON is broken and still runs the action', async () => {
    const engine = realDispatch();
    // A closing brace short of valid JSON — the failure mode agents actually
    // produce when a template-heavy document meets JSON structure.
    const broken = [
      '```json',
      '{"method": "validate_automation", "params": {"automation": {"version": 1, "name": "draft", "nodes": []}}',
      '```',
    ].join('\n');
    const { model } = scriptedModel([
      broken,
      reply('validate_automation', { automation: DOC_EXAMPLE.automation }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: engine.dispatch,
      model,
      policy: { maxTurns: 2 },
    });

    const first = session.transcript[0];
    expect(first.kind).toBe('action');
    expect(first.method).toBe('validate_automation');
    expect(first.lenient).toBe('auto-repaired malformed JSON');
    // The agent is told it deviated, so it stops relying on the repair layer.
    expect(session.messages[3].content).toContain(
      'auto-repaired malformed JSON',
    );
  });

  it('nudges a reply that carries no action at all', async () => {
    const engine = realDispatch();
    const { model, requests } = scriptedModel([
      'I think we should probably start by listing the orders somehow.',
      reply('validate_automation', { automation: DOC_EXAMPLE.automation }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: engine.dispatch,
      model,
      policy: { maxTurns: 2 },
    });

    const failure = session.transcript[0];
    expect(failure.kind).toBe('parse-error');
    expect(failure.fruitlessReason).toBe('parse-failure');
    expect(failure.progress).toBe(false);
    // The nudge names the protocol and reaches the model on the next turn.
    const nudge = session.messages[3].content;
    expect(nudge).toContain('Protocol error:');
    expect(nudge).toContain('exactly ONE action in a single fenced yaml block');
    expect(requests[1].at(-1)?.content).toBe(nudge);
    // The session recovers rather than ending on the protocol slip.
    expect(session.transcript[1]).toMatchObject({
      kind: 'action',
      method: 'validate_automation',
    });
  });
});

describe('a failing result is fed back so the next turn can fix it', () => {
  it('puts the validation errors in front of the model verbatim', async () => {
    const engine = realDispatch();
    const brokenAutomation = {
      version: 1,
      name: 'broken',
      nodes: [{ id: 'shape', type: 'transform' }],
    };
    const { model, requests } = scriptedModel([
      reply('run_automation', { automation: brokenAutomation, input: {} }),
      reply('run_automation', {
        automation: DOC_EXAMPLE.automation,
        input: DOC_EXAMPLE.input,
      }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: engine.dispatch,
      model,
      policy: { maxTurns: 2 },
    });

    const invalid = session.transcript[0].result as RunResult;
    expect(invalid.status).toBe('invalid');
    expect(invalid.validation?.errors.length).toBeGreaterThan(0);

    // The second turn's prompt carries those exact errors, plus the
    // reflection nudge that makes the model diagnose before it retries.
    const secondPrompt = requests[1].at(-1)?.content ?? '';
    expect(secondPrompt).toContain('run_automation result:');
    expect(secondPrompt).toContain(invalid.validation?.errors[0].code ?? '');
    expect(secondPrompt).toContain(REFLECTION_NUDGE);

    // And the fix lands: the corrected document executes.
    expect((session.transcript[1].result as RunResult).status).toBe('success');
    expect(session.transcript[1].progress).toBe(true);
  });

  it('lets the dispatch table answer an invented method — there is no second one', async () => {
    const engine = realDispatch();
    const { model } = scriptedModel([
      reply('publish_automation', { name: 'x' }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: engine.dispatch,
      model,
      policy: { maxTurns: 1 },
    });

    expect(session.transcript[0].result).toMatchObject({
      error: 'unknown method "publish_automation"',
    });
    expect(session.outcome.status).toBe('gave-up');
  });
});

describe('the fruitless-turn restart', () => {
  it('fires after exactly six fruitless turns and seeds what was learned', async () => {
    const repeated = reply('search_catalog', { query: 'email' });
    const { model, requests } = scriptedModel([
      // 1: new action → progress. 2-7: the same action six more times.
      repeated,
      repeated,
      repeated,
      repeated,
      repeated,
      repeated,
      repeated,
      reply('search_catalog', { query: 'send mail' }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: async () => ({ matches: [] }),
      model,
      policy: { maxTurns: 8, restartAfterFruitless: 6, maxRestarts: 1 },
    });

    const restarts = session.transcript.filter(
      (entry) => entry.kind === 'restart',
    );
    expect(restarts).toHaveLength(1);
    expect(restarts[0].turn).toBe(8);
    expect(session.restarts).toBe(1);

    // Five fruitless turns are not enough: turn 7 still ran on the old
    // conversation, which by then was long.
    expect(requests[6].length).toBeGreaterThan(3);

    // The restarted attempt begins fresh — system prompt, job, and a short
    // factual summary of the abandoned attempt.
    expect(requests[7]).toHaveLength(3);
    expect(requests[7][2].content).toContain(
      'A previous attempt was abandoned after 7 turns without progress',
    );
    expect(requests[7][2].content).toContain('search_catalog ×7');
  });

  it('counts a repeated identical error as fruitless', async () => {
    const { model } = scriptedModel([
      (request) =>
        reply('validate_automation', {
          automation: { name: `draft-${request.turn}` },
        }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      // Distinct actions, same error every time: nothing is being learned.
      dispatch: async () => ({
        valid: false,
        errors: [{ code: 'WF_NO_NODES' }],
      }),
      model,
      policy: { maxTurns: 9, restartAfterFruitless: 6, maxRestarts: 1 },
    });

    const restart = session.transcript.find(
      (entry) => entry.kind === 'restart',
    );
    // Turn 1 is new information; turns 2-7 repeat it; the restart follows.
    expect(restart?.turn).toBe(8);
    expect(
      session.transcript.filter(
        (entry) =>
          entry.turn <= 7 && entry.fruitlessReason === 'repeated-error',
      ),
    ).toHaveLength(6);
    // The fresh attempt starts the count over — turn 8 carried information
    // the new conversation had not seen.
    expect(
      session.transcript.find(
        (entry) => entry.turn === 8 && entry.kind === 'action',
      )?.progress,
    ).toBe(true);
  });

  it('gives up cleanly when a restarted attempt gets stuck again', async () => {
    const repeated = reply('search_catalog', { query: 'email' });
    const { model } = scriptedModel([repeated]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: async () => ({ matches: [] }),
      model,
      policy: { maxTurns: 40, restartAfterFruitless: 3, maxRestarts: 1 },
    });

    expect(session.restarts).toBe(1);
    expect(session.outcome).toEqual({
      status: 'gave-up',
      reason:
        'no progress in 3 consecutive turns, and the restart budget is spent',
    });
    // It stopped long before the turn budget rather than grinding it out.
    expect(session.turns).toBeLessThan(12);
  });
});

describe('bounded, terminal, and never silent', () => {
  it('ends on the turn cap with a reason', async () => {
    const { model, requests } = scriptedModel([
      (request) =>
        reply('search_catalog', { query: `attempt ${request.turn}` }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: async () => ({ matches: [] }),
      model,
      policy: { maxTurns: 3 },
    });

    expect(session.outcome).toEqual({
      status: 'gave-up',
      reason: 'the 3-turn budget is exhausted',
    });
    expect(session.turns).toBe(3);
    expect(requests).toHaveLength(3);
  });

  it('ends on the wall-clock deadline with a reason', async () => {
    let clock = 0;
    const { model } = scriptedModel([
      (request) =>
        reply('search_catalog', { query: `attempt ${request.turn}` }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: async () => ({ matches: [] }),
      model,
      now: () => {
        clock += 30_000;
        return clock;
      },
      policy: { maxTurns: 14, deadlineMs: 60_000 },
    });

    expect(session.outcome.status).toBe('gave-up');
    expect(session.outcome).toMatchObject({
      reason: 'the 60s session deadline passed',
    });
  });

  it('ends as cancelled when the caller pulls the plug', async () => {
    let turns = 0;
    const { model } = scriptedModel([
      (request) => {
        turns = request.turn;
        return reply('search_catalog', { query: `attempt ${request.turn}` });
      },
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: async () => ({ matches: [] }),
      model,
      isCancelled: () => turns >= 2,
      policy: { maxTurns: 14 },
    });

    expect(session.outcome).toEqual({
      status: 'cancelled',
      reason: 'the caller cancelled the session',
    });
    expect(session.turns).toBe(2);
  });

  it('ends with a reason when the model call itself fails', async () => {
    const model: BuilderModel = async () => {
      throw new Error('upstream 503');
    };

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: async () => ({}),
      model,
    });

    expect(session.outcome).toEqual({
      status: 'gave-up',
      reason: 'the model call failed: upstream 503',
    });
    expect(session.turns).toBe(1);
  });
});

describe('history is kept whole', () => {
  it('never summarizes or rewrites: each turn sees the previous one verbatim', async () => {
    const engine = realDispatch();
    const { model, requests } = scriptedModel([
      reply('validate_automation', { automation: DOC_EXAMPLE.automation }),
      reply('run_automation', {
        automation: DOC_EXAMPLE.automation,
        input: DOC_EXAMPLE.input,
      }),
      reply('test_automation', { automation: DOC_EXAMPLE.automation }),
      reply('save_automation', { automation: DOC_EXAMPLE.automation }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      dispatch: engine.dispatch,
      model,
    });

    expect(session.outcome.status).toBe('succeeded');
    // Each conversation is a strict prefix of the next: nothing was dropped,
    // merged, shortened or replaced by a summary anywhere in the session.
    for (let i = 1; i < requests.length; i++) {
      const previous = requests[i - 1];
      const current = requests[i];
      expect(current.length).toBe(previous.length + 2);
      expect(current.slice(0, previous.length)).toEqual(previous);
    }
    // Seed + (assistant, feedback) per turn, minus the feedback for the
    // saving turn, which ends the session.
    expect(session.messages).toHaveLength(2 + 2 * 3 + 1);
    expect(
      session.transcript.some((entry) => entry.kind === 'history-truncated'),
    ).toBe(false);
  });

  it('drops the oldest turns with a visible notice when the window overflows', async () => {
    const { model } = scriptedModel([
      (request) =>
        reply('search_catalog', { query: `attempt ${request.turn}` }),
    ]);

    const session = await runBuilderSession({
      goal: GOAL,
      // A chunky result, so a few turns overflow the tiny budget below.
      dispatch: async () => ({ matches: ['x'.repeat(300)] }),
      model,
      systemPrompt: 'SYSTEM',
      policy: { maxTurns: 6, maxHistoryChars: 1200 },
    });

    expect(
      session.transcript.filter((entry) => entry.kind === 'history-truncated')
        .length,
    ).toBeGreaterThan(0);
    // The seed survives, and the loss is stated in the conversation itself.
    expect(session.messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(session.messages[1].content).toContain(GOAL);
    expect(session.messages[2].content).toContain('Context notice:');
    expect(session.messages[2].content).toContain('Nothing was summarized');
    // The freshest exchange is always intact.
    expect(session.messages.at(-1)?.content).toContain(
      'search_catalog result:',
    );
  });
});
