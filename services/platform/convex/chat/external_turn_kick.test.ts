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
  sessionDeleteFiles: vi.fn().mockResolvedValue(undefined),
  sessionExecStatus: vi.fn(),
  sessionIsAlive: (...args: unknown[]) => mockSessionIsAlive(...args),
  sessionListFiles: vi.fn().mockResolvedValue([]),
  sessionStageFiles: (...args: unknown[]) => mockStageFiles(...args),
  SessionDuplicateError: class SessionDuplicateError extends Error {},
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));
const mockProvision = vi.fn();
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: (...args: unknown[]) => mockProvision(...args),
}));
// The slash resolution and skill staging resolve the org slug; the real
// helper hits the Better Auth component, whose refs this file's name-based
// ctx cannot answer.
vi.mock('../lib/helpers/org_slug', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  orgSlugFromId: () => Promise.resolve('acme'),
}));
const mockResolveConnectorCredential = vi.fn();
vi.mock('../connector_credentials/resolve_credential', () => ({
  resolveConnectorCredential: (...args: unknown[]) =>
    mockResolveConnectorCredential(...args),
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
  ownerIdentity?: { name: string; email: string } | null;
  /** What `skills/file_actions:readSkill` answers a slash resolution with. */
  slashSkill?: Record<string, unknown> | null;
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
    if (name.endsWith('getSessionOwnerIdentity')) {
      return Promise.resolve(overrides.ownerIdentity ?? null);
    }
    if (name.endsWith('getExternalTurnOpForFinalize')) {
      return Promise.resolve({ startedAt: 1 });
    }
    if (name.endsWith('getUserSkillViewerContext')) {
      return Promise.resolve({ teamIds: [], isOrgAdmin: false });
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
    if (name.endsWith('file_actions:readSkill')) {
      return Promise.resolve(
        overrides.slashSkill === undefined ? null : overrides.slashSkill,
      );
    }
    if (name.endsWith('file_actions:readSkillBundle')) {
      return Promise.resolve({
        files: [
          {
            path: 'SKILL.md',
            contentBase64: Buffer.from('# Skill\n').toString('base64'),
          },
        ],
      });
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

  it("runs a subscription model on its own vendor's harness — the token authenticates directly", async () => {
    const { ctx, tape } = createCtx({
      listing: {
        models: [
          ...MODEL_LISTING.models,
          {
            id: 'claude-fable-5',
            label: 'claude-fable-5',
            providerSlug: 'anthropic',
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
      modelId: 'claude-fable-5',
    });

    expect(result.status).toBe('completed');
    const start = tape.find((t) => t.event.includes('startExternalTurnExec'));
    expect(start).toBeDefined();
    expect(start?.args).toMatchObject({
      serving: 'subscription',
      // The vendor CLI gets the vendor-native id, never a gateway ref.
      gatewayModel: 'claude-fable-5',
      providerSlug: 'anthropic',
    });
  });

  it('refuses a subscription model picked for a DIFFERENT harness, naming the right agent', async () => {
    const { ctx } = createCtx({
      listing: {
        models: [
          ...MODEL_LISTING.models,
          {
            id: 'gpt-plan-5',
            label: 'gpt-plan-5',
            providerSlug: 'openai',
            credential: {
              authMethod: 'subscription-key',
              constraints: { execution: 'sandbox', harness: 'codex' },
            },
          },
        ],
        externalAgents: [],
      },
    });

    const result = await kickExternalTurn(ctx as never, {
      ...KICK_ARGS,
      modelId: 'gpt-plan-5',
    });

    expect(result.status).toBe('refused');
    expect(result.reason).toContain('codex');
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
    serving: 'gateway' as const,
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

  it('brokers the github grant into the exec env — token, helper, identity, audit — under the harness env', async () => {
    const { ctx, tape } = createCtx({
      thread: { capabilities: { skills: [], connectors: ['github'] } },
      ownerIdentity: { name: 'Ada Lovelace', email: 'ada@example.com' },
    });
    mockSessionIsAlive.mockResolvedValue(true);
    mockProvision.mockResolvedValue({
      token: 'sk-bf-test',
      keyId: 'vk_test_1',
      keyHash: 'hash',
    });
    mockStageFiles.mockResolvedValue({ staged: [], skipped: [] });
    mockResolveConnectorCredential.mockResolvedValue({
      credentialId: 'cred-1',
      connectorSlug: 'github',
      authMethod: 'bearer',
      secrets: { token: 'gh-pat' },
      config: {},
    });
    mockDrain.mockResolvedValue({
      status: 'completed',
      exitCode: 1,
      durationMs: 5,
      stdoutBase64: '',
      stderrBase64: '',
      truncated: { stdout: false, stderr: false },
    });

    await runExternalTurnStart(ctx as never, START_ARGS);

    expect(mockResolveConnectorCredential).toHaveBeenCalledWith(
      expect.anything(),
      { organizationId: ORG, connectorSlug: 'github' },
    );
    const body = mockDrain.mock.calls[0]?.[1] as {
      env?: Record<string, string>;
    };
    // The git CLI's credential env plus the in-image helper activation.
    expect(body.env?.GITHUB_TOKEN).toBe('gh-pat');
    expect(body.env?.GH_TOKEN).toBe('gh-pat');
    expect(Object.values(body.env ?? {})).toContain(
      '/usr/local/bin/tale-git-credential',
    );
    // The owner's author identity rides along.
    expect(Object.values(body.env ?? {})).toContain('Ada Lovelace');
    // The harness's own managed credential env is never shadowed.
    expect(body.env?.ANTHROPIC_AUTH_TOKEN).toBe('sk-bf-test');
    // Every Tier-2 fetch is audited.
    expect(events(tape).some((e) => e.includes('recordCredentialAccess'))).toBe(
      true,
    );
    // The equipped connector also materializes as a staged skill, so the
    // agent can discover what it is equipped with.
    const stagedPaths = mockStageFiles.mock.calls.flatMap((call) =>
      (call[1] as Array<{ path: string }>).map((file) => file.path),
    );
    expect(stagedPaths).toContain(
      'workspace/.tale/skills/connector-github/SKILL.md',
    );
  });

  it('runs the turn without git credentials when the broker cannot resolve the grant', async () => {
    const { ctx, tape } = createCtx({
      thread: { capabilities: { skills: [], connectors: ['github'] } },
    });
    mockSessionIsAlive.mockResolvedValue(true);
    mockProvision.mockResolvedValue({
      token: 'sk-bf-test',
      keyId: 'vk_test_1',
      keyHash: 'hash',
    });
    mockStageFiles.mockResolvedValue({ staged: [], skipped: [] });
    mockResolveConnectorCredential.mockRejectedValue(
      new Error('No default credential is configured for "github"'),
    );
    mockDrain.mockResolvedValue({
      status: 'completed',
      exitCode: 1,
      durationMs: 5,
      stdoutBase64: '',
      stderrBase64: '',
      truncated: { stdout: false, stderr: false },
    });

    await runExternalTurnStart(ctx as never, START_ARGS);

    // The turn still starts — a broker gap downgrades, never kills.
    expect(mockDrain).toHaveBeenCalledTimes(1);
    const body = mockDrain.mock.calls[0]?.[1] as {
      env?: Record<string, string>;
    };
    expect(body.env?.GITHUB_TOKEN).toBeUndefined();
    expect(events(tape).some((e) => e.includes('recordCredentialAccess'))).toBe(
      false,
    );
  });
});

describe('runExternalTurnStart — the slash command', () => {
  const START_ARGS = {
    organizationId: ORG,
    threadId: THREAD,
    userId: USER,
    userText: '/pdf extract the tables',
    harness: 'claude-code',
    providerSlug: 'openrouter',
    modelId: 'deepseek/deepseek-v3.2',
    gatewayModel: 'openrouter/deepseek/deepseek-v3.2',
    serving: 'gateway' as const,
    execId: EXEC,
    streamId: 'stream_1',
    messageId: 'msg_assistant' as never,
    deadlineAt: Date.now() + 60_000,
  };

  /** The drained exec, as matchable text plus the decoded stdin message. */
  function drainedExec(): { text: string; stdin: string } {
    const call = mockDrain.mock.calls[0] ?? [];
    const body = call[1] as { stdinBase64?: string } | undefined;
    return {
      text: JSON.stringify(call).replaceAll(String.raw`\"`, '"'),
      stdin: Buffer.from(body?.stdinBase64 ?? '', 'base64').toString('utf-8'),
    };
  }

  function armHappyPath() {
    mockSessionIsAlive.mockResolvedValue(true);
    mockProvision.mockResolvedValue({
      token: 'sk-bf-test',
      keyId: 'vk_test_1',
      keyHash: 'hash',
    });
    mockStageFiles.mockResolvedValue({ staged: [], skipped: [] });
    mockDrain.mockResolvedValue({
      status: 'completed',
      exitCode: 1,
      durationMs: 5,
      stdoutBase64: '',
      stderrBase64: '',
      truncated: { stdout: false, stderr: false },
    });
  }

  it('stages the invoked skill for the turn and carries the directive, prompt verbatim', async () => {
    const { ctx, tape } = createCtx({ slashSkill: { slug: 'pdf' } });
    armHappyPath();

    await runExternalTurnStart(ctx as never, START_ARGS);

    // Resolved with the owner's chat-surface viewer.
    const resolve = tape.find(
      (t) => t.event.includes('readSkill') && !t.event.includes('Bundle'),
    );
    expect(resolve).toBeDefined();
    expect(resolve?.args).toMatchObject({
      orgSlug: 'acme',
      slug: 'pdf',
      surface: 'chat',
      viewer: { kind: 'user', userId: USER },
    });

    // The bundle staged like any equipped skill…
    const stagedPaths = (
      (mockStageFiles.mock.calls[0]?.[1] ?? []) as Array<{ path: string }>
    ).map((f) => f.path);
    expect(stagedPaths).toContain('workspace/.tale/skills/pdf/SKILL.md');

    // …and the exec carries both the equip line and the one-turn directive
    // (the glue embeds instructions harness-specifically, so the assertion
    // reads the whole drained call), while the raw message rides the stdin
    // envelope verbatim, slash prefix included.
    const drained = drainedExec();
    expect(drained.text).toContain('/user/workspace/.tale/skills/pdf/SKILL.md');
    expect(drained.text).toContain('invokes the skill "pdf"');
    expect(drained.text).toContain("skill's arguments");
    expect(drained.text).not.toContain('none were given');
    expect(drained.stdin).toContain('/pdf extract the tables');

    // The thread's stored equipment is never written by a slash turn.
    expect(events(tape).some((e) => e.includes('setThreadCapabilities'))).toBe(
      false,
    );
  });

  it('notes when the invocation carried no arguments', async () => {
    const { ctx } = createCtx({ slashSkill: { slug: 'pdf' } });
    armHappyPath();

    await runExternalTurnStart(ctx as never, {
      ...START_ARGS,
      userText: '/pdf',
    });

    expect(drainedExec().text).toContain('none were given');
  });

  it('sends an unknown or invisible slug as ordinary text, with no directive', async () => {
    const { ctx, tape } = createCtx({ slashSkill: null });
    armHappyPath();

    await runExternalTurnStart(ctx as never, {
      ...START_ARGS,
      userText: '/nope do something',
    });

    // It asked, learned the skill is not usable here, and moved on.
    expect(
      events(tape).some(
        (e) => e.includes('readSkill') && !e.includes('Bundle'),
      ),
    ).toBe(true);
    expect(mockStageFiles).not.toHaveBeenCalled();
    const drained = drainedExec();
    expect(drained.text).not.toContain('invokes the skill');
    expect(drained.stdin).toContain('/nope do something');
  });

  it('never resolves anything for a message that is not a command', async () => {
    const { ctx, tape } = createCtx();
    armHappyPath();

    await runExternalTurnStart(ctx as never, {
      ...START_ARGS,
      userText: 'hello there',
    });

    expect(
      events(tape).some(
        (e) => e.includes('readSkill') && !e.includes('Bundle'),
      ),
    ).toBe(false);
  });

  it('stages a slash slug the thread already equips exactly once', async () => {
    const { ctx } = createCtx({
      slashSkill: { slug: 'pdf' },
      thread: { capabilities: { skills: ['pdf'], connectors: [] } },
    });
    armHappyPath();

    await runExternalTurnStart(ctx as never, START_ARGS);

    const stagedPaths = (
      (mockStageFiles.mock.calls[0]?.[1] ?? []) as Array<{ path: string }>
    ).map((f) => f.path);
    expect(
      stagedPaths.filter((p) => p === 'workspace/.tale/skills/pdf/SKILL.md'),
    ).toHaveLength(1);
  });
});
