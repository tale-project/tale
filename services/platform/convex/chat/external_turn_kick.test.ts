// Regression for the false "Failed to send message" toast: the composer
// AWAITS the kick, and a browser-held Convex action promise dies on every
// websocket reconnect — so the kick must be THIN. These lock the contract:
// refusals stay synchronous, the op row exists BEFORE the start action is
// scheduled (the recovery sweep's coverage anchor), the kick itself never
// talks to the sandbox, and the scheduled start settles the turn honestly on
// every failure (reason under the message) instead of leaving the thread
// generating forever.

import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSessionCreate = vi.fn();
const mockSessionIsAlive = vi.fn();
const mockDrain = vi.fn();
const mockStageFiles = vi.fn();
vi.mock('../node_only/sandbox/helpers/session_client', () => ({
  drainSessionExecResilient: (...args: unknown[]) => mockDrain(...args),
  sessionCancelExec: vi.fn().mockResolvedValue(undefined),
  sessionCreate: (...args: unknown[]) => mockSessionCreate(...args),
  sessionExecStatus: vi.fn(),
  sessionIsAlive: (...args: unknown[]) => mockSessionIsAlive(...args),
  sessionStageFiles: (...args: unknown[]) => mockStageFiles(...args),
  SessionDuplicateError: class SessionDuplicateError extends Error {},
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));
const mockProvision = vi.fn();
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: (...args: unknown[]) => mockProvision(...args),
}));
vi.mock('../node_only/sandbox/llm_gateway_admin', () => ({
  getVirtualKeySpendCents: vi.fn().mockResolvedValue(null),
  resolveGatewayRouting: (providerSlug: string, modelId: string) => ({
    gatewayProvider: providerSlug,
    gatewayModel: `${providerSlug}/${modelId}`,
  }),
  revokeVirtualKey: vi.fn().mockResolvedValue(undefined),
}));

import { kickExternalTurn, runExternalTurnStart } from './external_turn_action';

const ORG = 'org_1';
const THREAD = 'thread_1';
const USER = 'user_1';
const EXEC = 'exec_kick_1';

const KICK_ARGS = {
  organizationId: ORG,
  threadId: THREAD,
  userId: USER,
  userText: 'hello',
  harness: 'claude-code',
};

interface ListingModel {
  id: string;
  label: string;
  providerSlug: string;
  credential:
    | { authMethod: 'api-key' | 'env' }
    | {
        authMethod: 'subscription-key' | 'subscription-broker';
        constraints: { execution: 'sandbox'; harness: string };
      };
}

const MODEL_LISTING: { models: ListingModel[]; externalAgents: never[] } = {
  models: [
    {
      id: 'deepseek/deepseek-v3.2',
      label: 'deepseek/deepseek-v3.2',
      providerSlug: 'openrouter',
      credential: { authMethod: 'api-key' },
    },
  ],
  externalAgents: [],
};

interface CtxOverrides {
  thread?: Record<string, unknown> | null;
  busy?: boolean;
  listing?: typeof MODEL_LISTING;
  activeSession?: Record<string, unknown> | null;
  externalState?: Record<string, unknown> | null;
}

/** A mocked ActionCtx that answers by function name and records the order of
 * every write and schedule — the assertions read that tape. */
function createCtx(overrides: CtxOverrides = {}) {
  const tape: Array<{ event: string; args: unknown }> = [];
  const named = (ref: unknown) =>
    getFunctionName(ref as Parameters<typeof getFunctionName>[0]);

  const runQuery = vi.fn((ref: unknown, args?: unknown) => {
    const name = named(ref);
    tape.push({ event: `query:${name}`, args });
    if (name.endsWith('getOwnedThreadInternal')) {
      return Promise.resolve(
        overrides.thread === undefined ? {} : overrides.thread,
      );
    }
    if (name.endsWith('hasLiveGenerationInternal')) {
      return Promise.resolve(overrides.busy ?? false);
    }
    if (name.endsWith('getExternalTurnStateInternal')) {
      return Promise.resolve(
        overrides.externalState === undefined
          ? {
              messageId: 'msg_assistant',
              external: {
                execId: EXEC,
                lastSeq: 0,
                harness: 'claude-code',
                providerSlug: 'openrouter',
                gatewayModel: 'openrouter/deepseek/deepseek-v3.2',
              },
            }
          : overrides.externalState,
      );
    }
    if (name.endsWith('getActiveSessionByOwner')) {
      return Promise.resolve(
        overrides.activeSession === undefined
          ? { sessionId: 'sid' }
          : overrides.activeSession,
      );
    }
    if (name.endsWith('getProjectAgentCapabilitiesForThread')) {
      return Promise.resolve({ skills: [], connectors: [] });
    }
    if (name.endsWith('getExternalTurnOpForFinalize')) {
      return Promise.resolve({ startedAt: 1 });
    }
    return Promise.resolve(null);
  });

  const runMutation = vi.fn((ref: unknown, args?: unknown) => {
    const name = named(ref);
    tape.push({ event: `mutation:${name}`, args });
    if (name.endsWith('appendMessageInternal')) {
      return Promise.resolve({ id: 'msg_assistant' });
    }
    if (name.endsWith('reserveSessionSlotAndInsert')) {
      return Promise.resolve('session_row_1');
    }
    if (name.endsWith('claimSessionOpFinalize')) {
      return Promise.resolve(true);
    }
    return Promise.resolve(null);
  });

  const runAction = vi.fn((ref: unknown, args?: unknown) => {
    const name = named(ref);
    tape.push({ event: `action:${name}`, args });
    if (name.endsWith('listComposerModels')) {
      return Promise.resolve(overrides.listing ?? MODEL_LISTING);
    }
    return Promise.resolve(null);
  });

  const scheduler = {
    runAfter: vi.fn((_delay: number, ref: unknown, args?: unknown) => {
      tape.push({ event: `schedule:${named(ref)}`, args });
      return Promise.resolve(null);
    }),
    runAt: vi.fn(),
  };

  return { ctx: { runQuery, runMutation, runAction, scheduler }, tape };
}

function events(tape: Array<{ event: string }>): string[] {
  return tape.map((t) => t.event);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('kickExternalTurn — the thin-kick contract', () => {
  it('accepts fast: op row before the schedule, zero sandbox traffic', async () => {
    const { ctx, tape } = createCtx();

    const result = await kickExternalTurn(ctx as never, KICK_ARGS);

    expect(result).toEqual({ status: 'completed' });

    const seen = events(tape);
    const opIndex = seen.findIndex((e) =>
      e.endsWith('session_mutations:upsertSessionOp'),
    );
    const scheduleIndex = seen.findIndex((e) => e.startsWith('schedule:'));
    expect(opIndex).toBeGreaterThanOrEqual(0);
    expect(scheduleIndex).toBeGreaterThanOrEqual(0);
    // The op row is the recovery sweep's anchor: it must exist before any
    // hand-off, so a start action that dies at ANY step is swept.
    expect(opIndex).toBeLessThan(scheduleIndex);
    expect(seen[scheduleIndex]).toContain('startExternalTurnExec');

    // The kick never touches the sandbox or the gateway — that work belongs
    // to the scheduled start action.
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect(mockSessionIsAlive).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
    expect(mockProvision).not.toHaveBeenCalled();

    // The schedule carries the full turn context the start action needs.
    const scheduled = tape[scheduleIndex]?.args as Record<string, unknown>;
    expect(scheduled).toMatchObject({
      organizationId: ORG,
      threadId: THREAD,
      userId: USER,
      harness: 'claude-code',
      providerSlug: 'openrouter',
      modelId: 'deepseek/deepseek-v3.2',
    });
  });

  it('refuses a busy thread synchronously, appending nothing', async () => {
    const { ctx, tape } = createCtx({ busy: true });

    const result = await kickExternalTurn(ctx as never, KICK_ARGS);

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('already generating');
    expect(events(tape).some((e) => e.includes('appendMessageInternal'))).toBe(
      false,
    );
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('refuses with the provider-setup hint when no direct model exists', async () => {
    const { ctx, tape } = createCtx({
      listing: { models: [], externalAgents: [] },
    });

    const result = await kickExternalTurn(ctx as never, KICK_ARGS);

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('Settings → AI providers');
    // The refusal is written under an assistant message so the thread shows
    // it too, not just the toast.
    const refusal = tape.find(
      (t) =>
        t.event.includes('appendMessageInternal') &&
        (t.args as { blockedReason?: string }).blockedReason !== undefined,
    );
    expect(refusal).toBeDefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it("honors the composer's model pick over the first direct model", async () => {
    const { ctx, tape } = createCtx({
      listing: {
        models: [
          ...MODEL_LISTING.models,
          {
            id: 'zai/glm-5',
            label: 'zai/glm-5',
            providerSlug: 'zai',
            credential: { authMethod: 'env' },
          },
        ],
        externalAgents: [],
      },
    });

    const result = await kickExternalTurn(ctx as never, {
      ...KICK_ARGS,
      modelId: 'zai/glm-5',
    });

    expect(result).toEqual({ status: 'completed' });
    const scheduled = tape.find((t) => t.event.startsWith('schedule:'))
      ?.args as Record<string, unknown>;
    expect(scheduled).toMatchObject({
      providerSlug: 'zai',
      modelId: 'zai/glm-5',
    });
  });

  it('refuses a model pick no active credential serves, naming it', async () => {
    const { ctx, tape } = createCtx();

    const result = await kickExternalTurn(ctx as never, {
      ...KICK_ARGS,
      modelId: 'nope/unknown',
    });

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('nope/unknown');
    // The refusal lands under an assistant message, and nothing is scheduled.
    const refusal = tape.find(
      (t) =>
        t.event.includes('appendMessageInternal') &&
        (t.args as { blockedReason?: string }).blockedReason !== undefined,
    );
    expect(refusal).toBeDefined();
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('refuses a subscription-bound model pick — the managed lane cannot ride it', async () => {
    const { ctx } = createCtx({
      listing: {
        models: [
          ...MODEL_LISTING.models,
          {
            id: 'glm-5-plan',
            label: 'glm-5-plan',
            providerSlug: 'zai',
            credential: {
              authMethod: 'subscription-key',
              constraints: { execution: 'sandbox', harness: 'claude-code' },
            },
          },
        ],
        externalAgents: [],
      },
    });

    const result = await kickExternalTurn(ctx as never, {
      ...KICK_ARGS,
      modelId: 'glm-5-plan',
    });

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('subscription');
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });

  it('refuses a byo-only harness (cursor) against the real shipped config', async () => {
    const { ctx } = createCtx();

    const result = await kickExternalTurn(ctx as never, {
      ...KICK_ARGS,
      harness: 'cursor',
    });

    expect(result.status).toBe('refused');
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
  });
});

describe('runExternalTurnStart — async honesty', () => {
  const START_ARGS = {
    organizationId: ORG,
    threadId: THREAD,
    userId: USER,
    userText: 'hello',
    harness: 'claude-code',
    providerSlug: 'openrouter',
    modelId: 'deepseek/deepseek-v3.2',
    gatewayModel: 'openrouter/deepseek/deepseek-v3.2',
    execId: EXEC,
    streamId: 'stream_1',
    messageId: 'msg_assistant' as never,
    deadlineAt: Date.now() + 60_000,
  };

  it('settles the turn when the session ensure fails: reason under the message, op terminal, generation gone', async () => {
    const { ctx, tape } = createCtx({ activeSession: null });
    mockSessionCreate.mockRejectedValue(new Error('spawner down'));

    await runExternalTurnStart(ctx as never, START_ARGS);

    const finalize = tape.find((t) =>
      t.event.includes('finalizeAssistantMessageInternal'),
    );
    expect(finalize).toBeDefined();
    const finalizeArgs = (finalize?.args ?? {}) as { blockedReason?: string };
    expect(finalizeArgs.blockedReason).toContain('spawner down');

    const seen = events(tape);
    expect(seen.some((e) => e.includes('endGenerationInternal'))).toBe(true);
    const terminalOp = tape.find(
      (t) =>
        t.event.includes('session_mutations:upsertSessionOp') &&
        (t.args as { status?: string }).status === 'failed',
    );
    expect(terminalOp).toBeDefined();
    // Nothing was minted, nothing started.
    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
  });

  it('bails before minting when the user already stopped the turn', async () => {
    const { ctx, tape } = createCtx({ externalState: null });
    mockSessionIsAlive.mockResolvedValue(true);

    await runExternalTurnStart(ctx as never, START_ARGS);

    expect(mockProvision).not.toHaveBeenCalled();
    expect(mockDrain).not.toHaveBeenCalled();
    expect(
      events(tape).some((e) => e.includes('finalizeAssistantMessageInternal')),
    ).toBe(false);
  });

  it('mints, patches the op with the key id, and starts the exec', async () => {
    const { ctx, tape } = createCtx();
    mockSessionIsAlive.mockResolvedValue(true);
    mockProvision.mockResolvedValue({
      token: 'sk-bf-test',
      keyId: 'vk_test_1',
      keyHash: 'hash',
    });
    mockStageFiles.mockResolvedValue({ staged: [], skipped: [] });
    // The exec exits immediately with no harness events — the drain settles
    // it as a crash, which still proves the start→drain→finalize wiring.
    mockDrain.mockResolvedValue({
      status: 'completed',
      exitCode: 1,
      durationMs: 5,
      stdoutBase64: '',
      stderrBase64: '',
      truncated: { stdout: false, stderr: false },
    });

    await runExternalTurnStart(ctx as never, START_ARGS);

    expect(mockProvision).toHaveBeenCalledTimes(1);
    const patched = tape.find(
      (t) =>
        t.event.includes('session_mutations:upsertSessionOp') &&
        (t.args as { mintedKeyId?: string }).mintedKeyId === 'vk_test_1',
    );
    expect(patched).toBeDefined();
    expect(mockDrain).toHaveBeenCalledTimes(1);
    // The turn settled in this window — no self-chain needed.
    expect(ctx.scheduler.runAfter).not.toHaveBeenCalled();
    expect(events(tape).some((e) => e.includes('endGenerationInternal'))).toBe(
      true,
    );
  });
});
