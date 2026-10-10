// @vitest-environment node

/**
 * An agent node's resolved `input` reaches its live turn as a file: the kick
 * hands it to the scheduled start, the start stages it as `input.json` in
 * the turn's workspace through the inline-content staging every `files`
 * entry takes, and the instructions name the file, on the first start and on
 * the resume after an answered question alike. An input the sandbox could
 * not take inline is refused at the kick, in the words a refused staged file
 * reads, before any op row, scheduled start or sandbox session is spent. The
 * REAL hosts run with only external I/O replaced.
 */

import type { ModelCatalogEntry } from '@tale/shared/schemas/providers';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import type { ActionCtx } from '../lib/ctx';
import { resolveModel } from '../lib/providers/resolve_model';

const io = vi.hoisted(() => ({
  instructions: [] as string[],
  staged: [] as Array<{ path: string; contentBase64?: string }>,
  deleted: [] as string[],
}));

vi.mock('../chat/external_turn_shared', async (importActual) => {
  const actual =
    await importActual<typeof import('../chat/external_turn_shared')>();
  return {
    ...actual,
    buildExternalTurnExec: (
      args: Parameters<typeof actual.buildExternalTurnExec>[0],
    ) => {
      io.instructions.push(args.instructions);
      return actual.buildExternalTurnExec(args);
    },
    drainHarnessWindow: async () => ({
      kind: 'running',
      text: '',
      timeline: [],
    }),
  };
});
vi.mock(
  '../node_only/sandbox/helpers/session_client',
  async (importActual) => ({
    ...(await importActual<
      typeof import('../node_only/sandbox/helpers/session_client')
    >()),
    sessionStageFiles: async (
      _sessionId: string,
      files: Array<{ path: string; contentBase64?: string }>,
    ) => {
      io.staged.push(...files);
      return {
        staged: files.map((file) => ({ path: file.path, bytes: 0 })),
        skipped: [],
      };
    },
    sessionDeleteFiles: async (_sessionId: string, paths: string[]) => {
      io.deleted.push(...paths);
      return { deleted: paths, skipped: [] };
    },
  }),
);
vi.mock('../lib/providers/resolve_model', () => ({
  resolveModel: vi.fn(),
}));
vi.mock('../lib/providers/agent_serving', () => ({
  resolveWorkflowAgentServing: async () => ({
    lane: 'gateway',
    providerSlug: 'local-inference',
    modelId: 'qwen3-32b',
  }),
}));
vi.mock('../lib/providers/resolve_vision_model', () => ({
  resolveTurnVisionModel: async () => null,
}));
vi.mock('../lib/providers/resolve_image_model', () => ({
  resolveTurnImageGeneration: async () => null,
}));
vi.mock('../node_only/sandbox/agent_session', () => ({
  ensureAgentSession: async () => ({ liveCreatedAt: 1000 }),
}));
vi.mock('../node_only/sandbox/gateway_provisioning', () => ({
  provisionSessionGatewayKey: async () => ({
    token: 'test-token',
    keyId: 'key-new',
    keyHash: 'hash-new',
  }),
}));
vi.mock('../node_only/sandbox/turn_equipment', () => ({
  resolveTurnEquipmentEnv: async () => ({}),
}));

const {
  automationAgentHost,
  resumeWorkflowAgentTurnWithAnswerImpl,
  startWorkflowAgentTurnImpl,
  WORKFLOW_INPUT_MAX_BYTES,
  withStagedInput,
} = await import('./agent_host');

const ORG = 'org-1';

/** The sentence that tells the agent where its input is. */
const NAMED = /\/agent\/workspace\/input\.json\b/;

const INPUT = { customer: 'Ada Lovelace', invoices: [41, 42] };

/** The bytes `input.json` holds for {@link INPUT}. */
const INPUT_JSON = `${JSON.stringify(INPUT, null, 2)}\n`;

/** The staging refusal an oversized input reads. */
const TOO_LARGE =
  'staging input files failed: workspace/input.json (too_large)';

/** A string value whose `input.json` takes `bytes` bytes exactly. */
function inputOfBytes(bytes: number): string {
  // The JSON of a plain string is the string in quotes, plus the newline.
  return 'x'.repeat(bytes - 3);
}

const ASK = {
  _id: 'ask-1',
  runId: 'run-1',
  nodeId: 'brief',
  execId: 'exec-asking',
  question: 'Which plan?',
  expiresAt: Date.now() + 60_000,
  status: 'answered',
  answer: 'Gold.',
  agentSessionId: 'claude-session-1',
};

/** A run whose cursor waits on the asking exec, with `request` parked. */
function waitingCursor(request: Record<string, unknown>) {
  return {
    status: 'waiting',
    cursor: {
      node: 'brief',
      agent: {
        execId: 'exec-asking',
        sessionId: 'wf-run-1',
        deadlineAt: Date.now() + 60_000,
        providerSlug: 'local-inference',
        gatewayModel: 'local-inference-org-1/qwen3-32b',
        harness: 'claude-code',
        input: request,
      },
    },
  };
}

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function makeCtx(cursor: unknown) {
  const mutations: Call[] = [];
  const scheduled: Call[] = [];
  const ctx = {
    runQuery: async (ref: unknown) => {
      const name = functionRefName(ref);
      switch (name) {
        case 'automations/queries:readAgentCursor':
          return cursor;
        case 'automations/queries:getRunLanguageContext':
          return { defaultLocale: 'en', task: null };
        case 'automations/queries:getRunProjectContext':
          return { project: null, boundProjects: [], bound: false };
        case 'automations/queries:getRunProjectId':
          return null;
        case 'automations/human_asks:listAnsweredAsksForNode':
          return [];
        case 'automations/human_asks:getAskForResume':
          return ASK;
        case 'sandbox/session_queries:getSessionOpAttribution':
          return { userId: 'user-starter', agentSlug: 'onboarding/brief' };
        case 'governance/queries:getContextCapInternal':
          return null;
        case 'governance/internal_queries:getPolicyConfigInternal':
          return null;
        default:
          throw new Error(`unexpected query ${name}`);
      }
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      mutations.push({ name, args });
      if (name === 'sandbox/session_mutations:reserveTurnBudget') {
        return { allowed: true, budgetCents: 500 };
      }
      if (name === 'automations/human_asks:retargetAgentCursor') {
        return { retargeted: true };
      }
      return null;
    },
    runAction: async (ref: unknown) => {
      throw new Error(`unexpected action ${functionRefName(ref)}`);
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ name: functionRefName(ref), args });
        return 'job';
      },
    },
  } as unknown as ActionCtx;
  return { ctx, mutations, scheduled };
}

const REQUEST = {
  model: 'qwen3-32b',
  prompt: 'Write the onboarding brief.',
};

const START = {
  organizationId: ORG,
  runId: 'run-1',
  nodeId: 'brief',
  execId: 'exec-1',
  sessionId: 'wf-run-1',
  harness: 'claude-code',
  lane: 'gateway',
  providerSlug: 'local-inference',
  modelId: 'qwen3-32b',
  gatewayModel: 'local-inference-org-1/qwen3-32b',
  deadlineAt: Date.now() + 60_000,
  request: REQUEST,
};

beforeEach(() => {
  io.instructions = [];
  io.staged = [];
  io.deleted = [];
  const entry: ModelCatalogEntry = {
    id: 'qwen3-32b',
    provider: 'local-inference',
    tags: ['chat'],
    supportsTools: true,
    supportsVision: false,
    contextWindow: 32_768,
  };
  vi.mocked(resolveModel).mockResolvedValue({
    entry,
    connector: { name: 'local-inference' } as never,
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the staging of an agent node input', () => {
  it('adds input.json, as inline content, to the files the node stages', () => {
    const files = { data: 'fld_1' };
    expect(withStagedInput(files, INPUT)).toEqual({
      data: 'fld_1',
      'input.json': { content: INPUT_JSON },
    });
    expect(files).toEqual({ data: 'fld_1' });
    expect(withStagedInput(undefined, null)).toEqual({
      'input.json': { content: 'null\n' },
    });
  });

  it('leaves the files as they are for a node without an input', () => {
    const files = { data: 'fld_1' };
    expect(withStagedInput(files, undefined)).toBe(files);
    expect(withStagedInput(undefined, undefined)).toBeUndefined();
  });

  it('takes an input up to the inline cap, counted in UTF-8 bytes, and refuses one past it', () => {
    expect(WORKFLOW_INPUT_MAX_BYTES).toBe(1024 * 1024);
    expect(() =>
      withStagedInput(undefined, inputOfBytes(WORKFLOW_INPUT_MAX_BYTES)),
    ).not.toThrow();
    expect(() =>
      withStagedInput(undefined, inputOfBytes(WORKFLOW_INPUT_MAX_BYTES + 1)),
    ).toThrow(TOO_LARGE);
    // Half as many characters, each two bytes: past the cap all the same.
    expect(() =>
      withStagedInput(undefined, 'é'.repeat(WORKFLOW_INPUT_MAX_BYTES / 2)),
    ).toThrow(TOO_LARGE);
  });

  it('refuses a files mount the input would silently replace', () => {
    for (const name of ['input.json', 'workspace/input.json', 'input.json/']) {
      expect(() =>
        withStagedInput({ [name]: { content: 'mine' } }, INPUT),
      ).toThrow(`the files mount name "${name}" is where this step's input`);
    }
    // Without an input, a mount of that name is the author's own.
    expect(withStagedInput({ 'input.json': 'fld_1' }, undefined)).toEqual({
      'input.json': 'fld_1',
    });
  });
});

describe("the kick of an agent node's turn", () => {
  it('hands the input to the scheduled start', async () => {
    const { ctx, scheduled } = makeCtx({ status: 'running' });

    await automationAgentHost(ctx, ORG).kick({
      runId: 'run-1',
      nodeId: 'brief',
      request: { ...REQUEST, input: INPUT },
    });

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.args.request).toEqual({ ...REQUEST, input: INPUT });
  });

  it('refuses an input the sandbox could not take inline before it spends anything', async () => {
    const { ctx, mutations, scheduled } = makeCtx({ status: 'running' });

    await expect(
      automationAgentHost(ctx, ORG).kick({
        runId: 'run-1',
        nodeId: 'brief',
        request: {
          ...REQUEST,
          input: inputOfBytes(WORKFLOW_INPUT_MAX_BYTES + 1),
        },
      }),
    ).rejects.toThrow(TOO_LARGE);
    expect(mutations).toEqual([]);
    expect(scheduled).toEqual([]);
  });

  it('refuses a files mount named like the input before it spends anything', async () => {
    const { ctx, mutations, scheduled } = makeCtx({ status: 'running' });

    await expect(
      automationAgentHost(ctx, ORG).kick({
        runId: 'run-1',
        nodeId: 'brief',
        request: {
          ...REQUEST,
          files: { 'input.json': { content: 'mine' } },
          input: INPUT,
        },
      }),
    ).rejects.toThrow("is where this step's input is staged");
    expect(mutations).toEqual([]);
    expect(scheduled).toEqual([]);
  });
});

describe("the start of an agent node's turn", () => {
  it('stages the input as input.json in the workspace and names the file', async () => {
    const { ctx } = makeCtx({ status: 'running' });

    await startWorkflowAgentTurnImpl(ctx, {
      ...START,
      request: { ...REQUEST, input: INPUT },
    } as never);

    expect(console.error).not.toHaveBeenCalled();
    expect(io.deleted).toEqual(['workspace/input.json']);
    expect(io.staged).toEqual([
      {
        path: 'workspace/input.json',
        contentBase64: Buffer.from(INPUT_JSON, 'utf8').toString('base64'),
      },
    ]);
    const instructions = io.instructions[0] ?? '';
    expect(instructions.split(NAMED)).toHaveLength(2);
    // The input is named once, not again among the staged folders.
    expect(instructions).not.toContain('/agent/workspace/input.json/');
  });

  it('stages it beside the files the node mounts, which are listed as before', async () => {
    const { ctx } = makeCtx({ status: 'running' });

    await startWorkflowAgentTurnImpl(ctx, {
      ...START,
      request: {
        ...REQUEST,
        files: { 'notes.md': { content: '# Notes' } },
        input: INPUT,
      },
    } as never);

    expect(io.staged.map((file) => file.path)).toEqual([
      'workspace/notes.md',
      'workspace/input.json',
    ]);
    const instructions = io.instructions[0] ?? '';
    expect(instructions).toContain(
      'Input files staged for this task:\n- /agent/workspace/notes.md/',
    );
    expect(instructions.split(NAMED)).toHaveLength(2);
  });

  it('stages nothing and names no input for a node without one', async () => {
    const { ctx } = makeCtx({ status: 'running' });

    await startWorkflowAgentTurnImpl(ctx, START as never);

    expect(io.staged).toEqual([]);
    expect(io.deleted).toEqual([]);
    expect(io.instructions[0]).toBeDefined();
    expect(io.instructions[0]).not.toContain('input.json');
  });
});

describe('the resume of an agent node after an answered question', () => {
  it('names the staged input again', async () => {
    const { ctx } = makeCtx(waitingCursor({ ...REQUEST, input: INPUT }));

    await resumeWorkflowAgentTurnWithAnswerImpl(ctx, {
      organizationId: ORG,
      askId: 'ask-1',
    } as never);

    expect(io.instructions).toHaveLength(1);
    expect((io.instructions[0] ?? '').split(NAMED)).toHaveLength(2);
  });

  it('names no input for a node without one', async () => {
    const { ctx } = makeCtx(waitingCursor(REQUEST));

    await resumeWorkflowAgentTurnWithAnswerImpl(ctx, {
      organizationId: ORG,
      askId: 'ask-1',
    } as never);

    expect(io.instructions).toHaveLength(1);
    expect(io.instructions[0]).not.toContain('input.json');
  });
});
