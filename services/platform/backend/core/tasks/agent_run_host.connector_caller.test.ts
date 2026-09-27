/**
 * A connector equipped on a project agent runs in its task run for the
 * member who started that run. The test drives the REAL start and steer
 * hosts (only external I/O replaced), keeps the session-token rows they
 * write, and sends each minted token through the REAL connectors bridge
 * route, which finds the row by the token's hash as it does in production.
 *
 * Observed 2026-09-27: the VAT agent had the GlitchTip connector equipped,
 * and every call from its task run answered `unavailable` /
 * `no_user_context`. The turn's token named no user, so a connector equipped
 * on the Agents tab could never run in a task run.
 */

import { createHash } from 'node:crypto';

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTOMATION_SUBJECT_ID } from '../../../lib/shared/constants/usage';
import { functionRefName } from '../../../lib/shared/handlers/function-refs';

const io = vi.hoisted(() => ({
  /** Every session-token row the hosts wrote, by token hash. */
  tokens: new Map<string, Record<string, unknown>>(),
  /** Members of `org-1` who may still be acted for. */
  members: new Set<string>(),
  /** The forensic rows the bridge wrote (the insert's bound values). */
  toolCalls: [] as unknown[][],
  /** The gateway key the next mint hands out. */
  nextKey: 'vk-turn-1',
}));

const { runConnectorAction } = vi.hoisted(() => ({
  runConnectorAction: vi.fn(),
}));

vi.mock('../chat/external_turn_shared', async (importActual) => {
  const actual =
    await importActual<typeof import('../chat/external_turn_shared')>();
  return {
    ...actual,
    // The exec launches and keeps running; the turn's own drive is not
    // what this test is about.
    drainHarnessWindow: async () => ({
      kind: 'running',
      text: '',
      timeline: [],
    }),
  };
});
vi.mock('../automations/agent_host', () => ({
  liveProgressSink: () => ({
    onText() {},
    onTimeline() {},
    async flush() {},
  }),
  releaseTurnKey: async () => ({ won: true }),
  stageWorkflowSkills: async () => '',
  workflowAgentBudgetCents: () => 500,
}));
vi.mock('../node_only/sandbox/helpers/session_client', async (importActual) => {
  const actual =
    await importActual<
      typeof import('../node_only/sandbox/helpers/session_client')
    >();
  return {
    ...actual,
    sessionCancelExec: async () => true,
    sessionExecStatus: async () => ({ state: 'exited', exitCode: 0 }),
    sessionDeleteFiles: async () => undefined,
    sessionListFiles: async () => [],
    sessionStageFiles: async () => ({ staged: [], skipped: [] }),
  };
});
vi.mock('../node_only/sandbox/agent_session', () => ({
  ensureAgentSession: async () => ({ liveCreatedAt: 1000 }),
}));
vi.mock('./task_serving', () => ({
  resolveTaskServing: async () => ({
    lane: 'gateway',
    providerSlug: 'local-inference',
    modelId: 'qwen3-32b',
  }),
}));
vi.mock('../lib/providers/resolve_model', () => ({
  resolveModel: async () => {
    throw new Error('no catalog entry in this test');
  },
}));
vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  // The session token IS the minted gateway key, hashed the way the bridge
  // hashes a bearer.
  provisionSessionGatewayKey: async () => ({
    token: io.nextKey,
    keyId: `id-${io.nextKey}`,
    keyHash: createHash('sha256').update(io.nextKey).digest('hex'),
  }),
}));
vi.mock('../node_only/sandbox/turn_equipment', () => ({
  resolveTurnEquipmentEnv: async () => ({}),
}));

// The bridge's side: the token rows the hosts wrote, the connector door.
vi.mock('../../domains/sandbox/sessions.ts', () => ({
  getSessionTokenByHash: async (_sql: unknown, tokenHash: string) => {
    const row = io.tokens.get(tokenHash);
    if (row === undefined) return null;
    return {
      organizationId: row.organizationId,
      sessionId: row.sessionId,
      scope: row.scope,
      llmGatewayKeyId: row.llmGatewayKeyId ?? null,
      expiresAt: row.expiresAt,
      revokedAt: null,
    };
  },
}));
vi.mock('../../domains/connectors/service.ts', () => ({ runConnectorAction }));
vi.mock('../../domains/connector_credentials/service.ts', () => ({
  resolveConnectorCredential: async () => ({ credentialId: 'cred-1' }),
}));
vi.mock('../connectors/hostcall_token.ts', () => ({
  verifyHostcallToken: vi.fn(),
}));

const { startTaskAgentTurnImpl, steerTaskAgentTurnImpl } =
  await import('./agent_run_host');
const { createConnectorBridgeRoutes } =
  await import('../../domains/connectors/bridge-routes.ts');

/** postgres.js as far as the bridge uses it: the membership read and the
 * forensic insert. */
const bridgeSql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?');
  if (text.includes('FROM "member"')) {
    const [organizationId, userId] = values;
    return Promise.resolve(
      organizationId === 'org-1' &&
        typeof userId === 'string' &&
        io.members.has(userId)
        ? [{ userId }]
        : [],
    );
  }
  if (text.includes('INSERT INTO app.sandbox_tool_calls')) {
    io.toolCalls.push(values);
    return Promise.resolve([]);
  }
  throw new Error(`unexpected query: ${text}`);
}) as unknown as Sql;

function callBridge(route: 'execute' | 'status', token: string, body = {}) {
  return createConnectorBridgeRoutes({ sql: bridgeSql }).request(`/${route}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

interface RunState {
  status: string;
  execId: string;
}

function makeCtx(run: RunState, attribution: unknown) {
  const queries: Array<{ name: string; args: Record<string, unknown> }> = [];
  const ctx = {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      queries.push({ name, args });
      if (name === 'tasks/agent_runs:getTaskAgentRunForDrive') {
        return { ...run, sessionId: 'pa-alice', organizationId: 'org-1' };
      }
      if (name === 'projects/internal_queries:getProjectAgentSkillScope') {
        return null;
      }
      if (name === 'tasks/agent_runs:getAgentLanguageContext') {
        return {
          defaultLocale: 'en',
          task: { id: 'task-1', title: 'Check the VAT run', description: null },
        };
      }
      if (name === 'tasks/agent_runs:getTaskBriefForAgentRun') {
        return {
          title: 'Check the VAT run',
          attachments: [],
          outputs: [],
          discussion: [],
        };
      }
      if (name === 'sandbox/session_queries:getOpSteerState') {
        return { status: 'running', finalized: false };
      }
      if (name === 'sandbox/session_queries:getSessionOpAttribution') {
        return attribution;
      }
      if (name === 'governance/queries:getContextCapInternal') return null;
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name === 'sandbox/session_mutations:insertSessionToken') {
        io.tokens.set(String(args.tokenHash), args);
      }
      if (name === 'tasks/agent_runs:setTaskAgentRunRunning') {
        run.status = 'running';
        return true;
      }
      if (name === 'tasks/agent_runs:rotateTaskAgentRunExec') {
        run.execId = 'exec-rotated';
        return { execId: 'exec-rotated' };
      }
      if (name === 'sandbox/session_mutations:reserveTurnBudget') {
        return { allowed: true, budgetCents: 500 };
      }
      return null;
    },
    runAction: async () => null,
    scheduler: {
      runAfter: async () => 'job',
      runAt: async () => 'job',
      cancel: async () => undefined,
    },
  };
  return { ctx: ctx as never, queries };
}

const KEYS = {
  organizationId: 'org-1',
  runId: 'run-1',
  taskId: 'task-1',
  agentId: 'alice',
  execId: 'exec-1',
  sessionId: 'pa-alice',
  harness: 'claude-code',
  deadlineAt: Date.now() + 60_000,
  model: 'qwen3-32b',
  modelProvider: 'local-inference',
  skills: [],
  connectors: ['glitchtip'],
  tools: [],
  secrets: [],
};

const LIST_ISSUES = {
  slug: 'glitchtip',
  operation: 'list_import_issues',
  args: { organizationSlug: 'tale' },
};

function scopeOf(token: string): Record<string, unknown> | undefined {
  const row = io.tokens.get(createHash('sha256').update(token).digest('hex'));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the host writes the scope as a plain record
  return row?.scope as Record<string, unknown> | undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  io.tokens.clear();
  io.members = new Set(['user-starter']);
  io.toolCalls = [];
  io.nextKey = 'vk-turn-1';
  runConnectorAction.mockResolvedValue({
    status: 'ok',
    output: { issues: [{ id: 'GT-1' }] },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('a task run of an agent equipped with a connector', () => {
  it('mints a token that acts for the run’s starter, and the bridge runs the connector for them', async () => {
    const { ctx, queries } = makeCtx(
      { status: 'queued', execId: 'exec-1' },
      { userId: 'user-starter', agentSlug: 'alice' },
    );

    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);
    const res = await callBridge('execute', 'vk-turn-1', LIST_ISSUES);

    // Before the fix this answered `unavailable` / `no_user_context`.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      output: { issues: [{ id: 'GT-1' }] },
    });
    // Whom the turn acts for is read through this very exec's attribution:
    // the run's starter, the person its spend is booked under.
    expect(
      queries.find(
        (q) => q.name === 'sandbox/session_queries:getSessionOpAttribution',
      )?.args,
    ).toEqual({
      organizationId: 'org-1',
      sessionId: 'pa-alice',
      execId: 'exec-1',
      kind: 'task-agent',
    });
    expect(scopeOf('vk-turn-1')).toMatchObject({
      connectorGrants: ['glitchtip'],
      connectorCaller: { kind: 'user', userId: 'user-starter' },
    });
    // Never a user-keyed token: the workspace tools keep reading with the
    // project binding's authority alone.
    expect(scopeOf('vk-turn-1')).not.toHaveProperty('userId');
    expect(runConnectorAction).toHaveBeenCalledTimes(1);
    expect(runConnectorAction.mock.calls[0]?.[1]).toMatchObject({
      organizationId: 'org-1',
      connector: 'glitchtip',
      action: 'list_import_issues',
      input: { organizationSlug: 'tale' },
      mode: 'live',
      caller: { kind: 'user', userId: 'user-starter' },
      execSessionId: 'pa-alice',
    });
    // The forensic row names the member the call ran for.
    expect(io.toolCalls).toHaveLength(1);
    expect(io.toolCalls[0]).toContain('user-starter');
    expect(io.toolCalls[0]).toContain('connector:glitchtip.list_import_issues');
  });

  it('lists the equipped connector as usable for the starter', async () => {
    const { ctx } = makeCtx(
      { status: 'queued', execId: 'exec-1' },
      { userId: 'user-starter' },
    );
    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

    const res = await callBridge('status', 'vk-turn-1');

    expect(await res.json()).toMatchObject({
      connectors: [{ slug: 'glitchtip', usable: true, blockers: [] }],
    });
  });

  it('keeps acting for the starter after a steer restart, on the rotated exec', async () => {
    const { ctx, queries } = makeCtx(
      { status: 'running', execId: 'exec-1' },
      { userId: 'user-starter' },
    );
    io.nextKey = 'vk-turn-2';

    // Codex has no stdin steering: the comment restarts the process and
    // mints the restarted exec its own token.
    await steerTaskAgentTurnImpl(ctx, {
      ...KEYS,
      harness: 'codex',
      feedback: 'Look at last week’s run too.',
      author: 'Dana',
      authorId: 'user-dana',
      attempt: 0,
    } as never);

    expect(
      queries.find(
        (q) => q.name === 'sandbox/session_queries:getSessionOpAttribution',
      )?.args,
    ).toMatchObject({ execId: 'exec-rotated', kind: 'task-agent' });
    // The comment's author steers; the run still acts for its starter.
    expect(scopeOf('vk-turn-2')).toMatchObject({
      connectorGrants: ['glitchtip'],
      connectorCaller: { kind: 'user', userId: 'user-starter' },
    });

    const res = await callBridge('execute', 'vk-turn-2', LIST_ISSUES);

    expect(await res.json()).toMatchObject({ status: 'ok' });
    expect(runConnectorAction.mock.calls[0]?.[1]).toMatchObject({
      caller: { kind: 'user', userId: 'user-starter' },
    });
  });

  it.each([
    ['names nobody', null],
    ['names the automation sentinel', { userId: AUTOMATION_SUBJECT_ID }],
  ])(
    'refuses with what to do when the run’s attribution %s',
    async (_label, attribution) => {
      const { ctx } = makeCtx(
        { status: 'queued', execId: 'exec-1' },
        attribution,
      );

      await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);

      expect(scopeOf('vk-turn-1')).toMatchObject({
        connectorCaller: { kind: 'nobody', opKind: 'task-agent' },
      });
      const res = await callBridge('execute', 'vk-turn-1', LIST_ISSUES);
      const body = (await res.json()) as {
        status: string;
        blockers: Array<{ code: string; guidance: string }>;
      };

      expect(body.status).toBe('unavailable');
      expect(body.blockers).toHaveLength(1);
      expect(body.blockers[0]?.code).toBe('no_user_context');
      // It says what to do, in the product's own words.
      expect(body.blockers[0]?.guidance).toContain('Start agent');
      expect(body.blockers[0]?.guidance).toContain('@mention');
      expect(runConnectorAction).not.toHaveBeenCalled();
      expect(io.toolCalls).toEqual([]);
    },
  );

  it('refuses a starter who left the organization since the kick', async () => {
    const { ctx } = makeCtx(
      { status: 'queued', execId: 'exec-1' },
      { userId: 'user-starter' },
    );
    await startTaskAgentTurnImpl(ctx, { ...KEYS, sweep: true } as never);
    io.members.delete('user-starter');

    const res = await callBridge('execute', 'vk-turn-1', LIST_ISSUES);

    expect(await res.json()).toMatchObject({
      status: 'unavailable',
      blockers: [{ code: 'access_denied' }],
    });
    expect(runConnectorAction).not.toHaveBeenCalled();
  });

  it('resolves no caller for a turn without connectors', async () => {
    const { ctx, queries } = makeCtx(
      { status: 'queued', execId: 'exec-1' },
      { userId: 'user-starter' },
    );

    await startTaskAgentTurnImpl(ctx, {
      ...KEYS,
      connectors: [],
      sweep: true,
    } as never);

    expect(scopeOf('vk-turn-1')).toMatchObject({ connectorGrants: [] });
    expect(scopeOf('vk-turn-1')).not.toHaveProperty('connectorCaller');
    expect(
      queries.some(
        (q) => q.name === 'sandbox/session_queries:getSessionOpAttribution',
      ),
    ).toBe(false);
  });
});
