import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replaces two deleted unified_chat_ttft.test.ts contracts now living in
// runChatTurnGeneration:
//   1. guardrails snapshot + governance resolve CONCURRENTLY (one round-trip).
//   2. the user message is SANITIZED before it is persisted via startChat.

vi.mock('../_generated/server', () => ({
  internalAction: (config: unknown) => config,
}));

const STARTCHAT = 'mock-startChat';
const GOVERNANCE = 'mock-resolveGenerationGovernance';
const CLEARGEN = 'mock-clearGenerationStatus';

vi.mock('../_generated/api', () => ({
  components: { agent: {} },
  internal: {
    agents: {
      start_chat: { startChat: STARTCHAT },
      auto_route: { resolveAutoRoute: 'mock-resolveAutoRoute' },
    },
    governance: {
      internal_queries: { resolveGenerationGovernance: GOVERNANCE },
    },
    threads: {
      internal_mutations: { clearGenerationStatus: CLEARGEN },
      mutations: { createArenaBranchLink: 'mock-createArenaBranchLink' },
    },
    projects: {
      internal_queries: {
        getProjectAllowedAgentSlugs: 'mock-getProjectAllowedAgentSlugs',
      },
    },
    audit_logs: {
      internal_mutations: { createAuditLog: 'mock-createAuditLog' },
    },
  },
}));

const mockLoadGuardrailsSnapshot = vi.fn();
const mockSanitizeMessage = vi.fn();
vi.mock('../governance/sanitize', () => ({
  loadGuardrailsSnapshot: (...a: unknown[]) => mockLoadGuardrailsSnapshot(...a),
  sanitizeMessage: (...a: unknown[]) => mockSanitizeMessage(...a),
}));

const mockRunGenerationCore = vi.fn();
vi.mock('../lib/agent_chat/internal_actions', () => ({
  runGenerationCore: (...a: unknown[]) => mockRunGenerationCore(...a),
}));

vi.mock('../organizations/resolve_org_slug', () => ({
  resolveOrgSlug: vi.fn().mockResolvedValue('acme'),
}));

vi.mock('./config', () => ({
  applyModelOverride: vi.fn(),
}));

const mockResolveAgentConfigInline = vi.fn();
vi.mock('./resolve_agent_config', () => ({
  resolveAgentConfigInline: (...a: unknown[]) =>
    mockResolveAgentConfigInline(...a),
}));

const { runChatTurnGeneration } = await import('./chat_turn_generate');

// internalAction is mocked to a passthrough, so the registered action is the
// plain `{ args, handler }` config at runtime; the cast bridges the framework
// type (RegisteredAction has no public `.handler`). Mirrors the sibling
// tool_building_parallelization.test.ts pattern.
const generationHandler = (
  runChatTurnGeneration as unknown as {
    handler: (...args: unknown[]) => Promise<unknown>;
  }
).handler;

const BASE_ARGS = {
  agentSlug: 'writer',
  organizationId: 'org_1',
  message: 'my raw secret message',
  threadId: 'thread_1',
  streamId: 'stream_1',
  userId: 'user_1',
  userEmail: 'u@example.com',
  userName: 'U',
};

function createCtx(startChatResult: unknown) {
  const runMutation = vi.fn().mockImplementation((ref: string) => {
    if (ref === STARTCHAT) return Promise.resolve(startChatResult);
    return Promise.resolve(undefined);
  });
  const runQuery = vi.fn().mockImplementation((ref: string) => {
    if (ref === GOVERNANCE) {
      return Promise.resolve({
        defaultModel: null,
        // PLAIN (qualifier-stripped) ids, as the real query returns.
        accessibleModelIds: ['gpt-4o'],
        explicitAccess: null,
        role: 'member',
        teamIds: [],
      });
    }
    return Promise.resolve(null);
  });
  return { runMutation, runQuery, runAction: vi.fn() };
}

describe('runChatTurnGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveAgentConfigInline.mockResolvedValue({
      config: { model: 'openrouter:gpt-4o' },
      supportedModels: ['openrouter:gpt-4o'],
      orgLocale: 'en',
    });
    mockLoadGuardrailsSnapshot.mockResolvedValue({ chatFilter: null });
    mockSanitizeMessage.mockResolvedValue({ text: 'SCRUBBED' });
  });

  it('sanitizes the user message before persisting it via startChat', async () => {
    const ctx = createCtx({
      messageAlreadyExists: false,
      streamId: 'stream_1',
      generationArgs: undefined, // short-circuit before runGenerationCore
    });

    const result = await generationHandler(ctx as never, BASE_ARGS as never);

    // sanitize runs on the RAW input...
    expect(mockSanitizeMessage).toHaveBeenCalledWith(
      ctx,
      'my raw secret message',
      'input',
      expect.anything(),
      expect.objectContaining({ organizationId: 'org_1' }),
    );
    // ...and startChat is persisted with the SANITIZED text, deferred.
    expect(ctx.runMutation).toHaveBeenCalledWith(
      STARTCHAT,
      expect.objectContaining({
        message: 'SCRUBBED',
        deferGeneration: true,
      }),
    );
    // No generationArgs → generation is finalized without running the core.
    expect(mockRunGenerationCore).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('resolves the guardrails snapshot and governance concurrently (one round-trip)', async () => {
    const ctx = createCtx({
      messageAlreadyExists: false,
      streamId: 'stream_1',
      generationArgs: undefined,
    });

    // Hold the guardrails snapshot pending; if governance were resolved
    // serially AFTER guardrails, its runQuery would not yet be called.
    let releaseGuardrails: (v: unknown) => void = () => {};
    mockLoadGuardrailsSnapshot.mockImplementation(
      () =>
        new Promise((res) => {
          releaseGuardrails = res;
        }),
    );

    const pending = generationHandler(ctx as never, BASE_ARGS as never);
    await Promise.resolve();
    await Promise.resolve();

    // Governance query already fired while guardrails is still pending → the
    // two run inside the same Promise.all, not one-after-the-other.
    expect(mockLoadGuardrailsSnapshot).toHaveBeenCalled();
    expect(ctx.runQuery).toHaveBeenCalledWith(GOVERNANCE, expect.anything());

    releaseGuardrails({ chatFilter: null });
    await pending;
  });
});
