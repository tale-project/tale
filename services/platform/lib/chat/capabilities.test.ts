import { describe, expect, it, vi } from 'vitest';

import { createIntegrationBackend } from './backends';
import {
  CAPABILITY_KINDS,
  CapabilityRegistry,
  capabilityDocs,
  createCapabilitySurface,
  isEventOnlyAutomation,
  isUnstructured,
  KNOWLEDGE_UNAVAILABLE_REASON,
  mcpToolsToCapabilities,
  type Capability,
  type CapabilityAuditEntry,
  type CapabilityBackends,
  type CapabilitySurfaceDeps,
  type McpToolDefinition,
  type MemoryRecord,
  type MemorySaveRequest,
  type MemoryStore,
} from './capabilities';

/**
 * The surface's promises: one registry that knows every kind, one dispatcher
 * that sends each kind to exactly one backend, an event-only automation that
 * is visible but not invocable, a memory tool that can only ever propose, and
 * a knowledge method that says "unavailable" instead of "nothing found".
 *
 * Every backend here is a spy — nothing runs, nothing leaves the process.
 */

const ORG = 'org_1';
const USER = 'user_1';

function objectSchema(
  properties: Record<string, unknown> = {},
): Record<string, unknown> {
  return { type: 'object', properties, additionalProperties: true };
}

function capability(overrides: Partial<Capability> = {}): Capability {
  return {
    kind: 'builtin',
    id: 'builtin.run_code',
    name: 'run_code',
    description: 'Run code in a sandbox.',
    inputSchema: objectSchema({ code: { type: 'string' } }),
    handler: 'run_code',
    ...overrides,
  } as Capability;
}

function fakeBackends(): {
  backends: CapabilityBackends;
  calls: Record<keyof CapabilityBackends, ReturnType<typeof vi.fn>>;
} {
  const calls = {
    builtin: vi.fn().mockResolvedValue({ status: 'ok', output: 'builtin' }),
    integration: vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: 'integration' }),
    skill: vi.fn().mockResolvedValue({ status: 'ok', output: 'skill' }),
    automation: vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: 'automation' }),
    mcp: vi.fn().mockResolvedValue({ status: 'ok', output: 'mcp' }),
  };
  return { backends: calls, calls };
}

function fakeMemoryStore(seed: readonly MemoryRecord[] = []): {
  store: MemoryStore;
  saved: MemorySaveRequest[];
} {
  const saved: MemorySaveRequest[] = [];
  return {
    saved,
    store: {
      save(request) {
        saved.push(request);
        return Promise.resolve({ id: `mem_${saved.length}` });
      },
      search() {
        return Promise.resolve(seed);
      },
    },
  };
}

function surface(
  overrides: Partial<CapabilitySurfaceDeps> = {},
  capabilities: readonly Capability[] = [capability()],
) {
  const registry = new CapabilityRegistry(ORG).registerAll(capabilities);
  const { backends, calls } = fakeBackends();
  const audit: CapabilityAuditEntry[] = [];
  const memory = fakeMemoryStore();
  const deps: CapabilitySurfaceDeps = {
    organizationId: ORG,
    userId: USER,
    registry,
    backends,
    memory: memory.store,
    audit: {
      record(entry) {
        audit.push(entry);
        return Promise.resolve();
      },
    },
    threadId: 'thread_1',
    now: () => 1_700_000_000_000,
    ...overrides,
  };
  return {
    surface: createCapabilitySurface(deps),
    registry,
    calls,
    audit,
    memory,
  };
}

describe('CapabilityRegistry', () => {
  it('is bound to one organization and refuses a surface for another', () => {
    const registry = new CapabilityRegistry('org_other');
    expect(() =>
      createCapabilitySurface({
        organizationId: ORG,
        userId: USER,
        registry,
        backends: fakeBackends().backends,
        memory: fakeMemoryStore().store,
        audit: { record: () => Promise.resolve() },
      }),
    ).toThrow(/different organization/);
  });

  it('refuses two capabilities answering to one id', () => {
    const registry = new CapabilityRegistry(ORG).register(capability());
    expect(() =>
      registry.register(capability({ kind: 'skill', slug: 'run-code' })),
    ).toThrow(/registered twice/);
  });
});

describe('search_capabilities', () => {
  const catalog: Capability[] = [
    capability(),
    capability({
      kind: 'integration-action',
      id: 'integration.github.list_issues',
      name: 'list_issues',
      description: 'List the open issues of a GitHub repository.',
      tags: ['github', 'issues'],
      connector: 'github',
      action: 'list_issues',
    }),
    capability({
      kind: 'automation',
      id: 'automation.github/triage-issues',
      name: 'Triage GitHub issues',
      description: 'Score open issues and rank the ones ready to be worked.',
      automation: 'github/triage-issues',
      eventOnly: false,
    }),
    capability({
      kind: 'skill',
      id: 'skill.write-release-notes',
      name: 'write-release-notes',
      description: 'How this team writes release notes.',
      slug: 'write-release-notes',
    }),
    capability({
      kind: 'mcp-tool',
      id: 'mcp.figma.get_file',
      name: 'get_file',
      description: 'Read a Figma file.',
      server: 'figma',
      tool: 'get_file',
    }),
  ];

  it('searches across every capability kind at once', () => {
    const { surface: s } = surface({}, catalog);
    const kinds = new Set(
      CAPABILITY_KINDS.flatMap((kind) =>
        s.searchCapabilities({ query: kindQuery(kind) }).map((hit) => hit.kind),
      ),
    );
    expect(kinds).toEqual(new Set(CAPABILITY_KINDS));
  });

  it('ranks by relevance and reports whether a hit is structured', () => {
    const { surface: s } = surface({}, catalog);
    const hits = s.searchCapabilities({ query: 'list_issues' });

    expect(hits[0]?.id).toBe('integration.github.list_issues');
    // No declared output schema, so the model is told the result is whatever
    // the connector returned.
    expect(hits[0]?.structured).toBe(false);
  });

  it('finds a capability by its description, not just its id', () => {
    const { surface: s } = surface({}, catalog);
    expect(
      s.searchCapabilities({ query: 'release notes' }).map((hit) => hit.id),
    ).toContain('skill.write-release-notes');
  });

  it('returns nothing rather than an arbitrary tail when nothing matches', () => {
    const { surface: s } = surface({}, catalog);
    expect(
      s.searchCapabilities({ query: 'quarterly revenue forecast' }),
    ).toEqual([]);
  });
});

function kindQuery(kind: string): string {
  switch (kind) {
    case 'builtin':
      return 'run_code';
    case 'integration-action':
      return 'github issues';
    case 'skill':
      return 'release notes';
    case 'automation':
      return 'triage';
    default:
      return 'figma';
  }
}

describe('invoke_capability — one backend per kind', () => {
  const catalog: Capability[] = [
    capability(),
    capability({
      kind: 'integration-action',
      id: 'integration.github.list_issues',
      connector: 'github',
      action: 'list_issues',
    }),
    capability({ kind: 'skill', id: 'skill.notes', slug: 'notes' }),
    capability({
      kind: 'automation',
      id: 'automation.daily',
      automation: 'daily',
      eventOnly: false,
    }),
    capability({
      kind: 'mcp-tool',
      id: 'mcp.figma.get_file',
      server: 'figma',
      tool: 'get_file',
    }),
  ];

  it('dispatches a builtin to the builtin backend', async () => {
    const { surface: s, calls } = surface({}, catalog);
    await expect(
      s.invokeCapability({ id: 'builtin.run_code', input: { code: '1+1' } }),
    ).resolves.toMatchObject({ status: 'ok', output: 'builtin' });
    expect(calls.builtin).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: USER,
      handler: 'run_code',
      input: { code: '1+1' },
    });
    expect(calls.integration).not.toHaveBeenCalled();
  });

  it('dispatches an integration action to the integrations dispatcher', async () => {
    const { surface: s, calls } = surface({}, catalog);
    await s.invokeCapability({
      id: 'integration.github.list_issues',
      input: { owner: 'tale' },
      credential: 'cred_2',
    });
    expect(calls.integration).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: USER,
      connector: 'github',
      action: 'list_issues',
      input: { owner: 'tale' },
      credentialRef: 'cred_2',
    });
  });

  it('dispatches a skill to the skills backend', async () => {
    const { surface: s, calls } = surface({}, catalog);
    await s.invokeCapability({ id: 'skill.notes' });
    expect(calls.skill).toHaveBeenCalledWith({
      organizationId: ORG,
      slug: 'notes',
      input: {},
    });
  });

  it('dispatches an automation to the automations store', async () => {
    const { surface: s, calls } = surface({}, catalog);
    await s.invokeCapability({ id: 'automation.daily', input: { dry: true } });
    expect(calls.automation).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: USER,
      automation: 'daily',
      input: { dry: true },
    });
  });

  it('dispatches an MCP tool to its server', async () => {
    const { surface: s, calls } = surface({}, catalog);
    await s.invokeCapability({ id: 'mcp.figma.get_file' });
    expect(calls.mcp).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: USER,
      server: 'figma',
      tool: 'get_file',
      input: {},
    });
  });

  it('validates the input before any backend runs', async () => {
    const { surface: s, calls } = surface({}, [
      capability({
        inputSchema: {
          type: 'object',
          properties: { code: { type: 'string' } },
          required: ['code'],
        },
      }),
    ]);

    const result = await s.invokeCapability({
      id: 'builtin.run_code',
      input: { code: 42 },
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(calls.builtin).not.toHaveBeenCalled();
  });

  it('refuses an unknown id with a suggestion instead of guessing', async () => {
    const { surface: s } = surface({}, catalog);
    const result = await s.invokeCapability({ id: 'builtin.run_cod' });
    expect(result).toMatchObject({
      status: 'refused',
      hint: 'Did you mean "builtin.run_code"?',
    });
  });

  it('passes a backend refusal through with its hint', async () => {
    const { backends } = fakeBackends();
    const refusing: CapabilityBackends = {
      ...backends,
      integration: vi.fn().mockResolvedValue({
        status: 'refused',
        reason: 'Approval required.',
        hint: 'Ask an admin.',
      }),
    };
    const { surface: s } = surface({ backends: refusing }, catalog);

    await expect(
      s.invokeCapability({ id: 'integration.github.list_issues' }),
    ).resolves.toMatchObject({
      status: 'refused',
      reason: 'Approval required.',
      hint: 'Ask an admin.',
    });
  });
});

describe('event-only automations', () => {
  const eventOnly = capability({
    kind: 'automation',
    id: 'automation.inbox/triage',
    name: 'Triage the shared inbox',
    description: 'Runs when an email arrives in the shared inbox.',
    automation: 'inbox/triage',
    eventOnly: true,
  });

  it('derives event-only from the manifest triggers', () => {
    expect(isEventOnlyAutomation([{ kind: 'event' }])).toBe(true);
    expect(
      isEventOnlyAutomation([{ kind: 'event' }, { kind: 'schedule' }]),
    ).toBe(false);
    expect(isEventOnlyAutomation([])).toBe(false);
    expect(isEventOnlyAutomation(undefined)).toBe(false);
  });

  it('lists it, marked EVENT-ONLY', () => {
    const { surface: s } = surface({}, [eventOnly]);
    const [hit] = s.searchCapabilities({ query: 'triage inbox' });

    expect(hit?.id).toBe('automation.inbox/triage');
    expect(hit?.eventOnly).toBe(true);
    expect(hit?.note).toContain('EVENT-ONLY');
  });

  it('refuses to invoke it, with a hint about what to do instead', async () => {
    const { surface: s, calls } = surface({}, [eventOnly]);
    const result = await s.invokeCapability({ id: 'automation.inbox/triage' });

    expect(result).toMatchObject({ status: 'refused' });
    expect(result).toHaveProperty(
      'reason',
      expect.stringContaining('event-only'),
    );
    expect(result).toHaveProperty('hint', expect.stringContaining('Trigger'));
    expect(calls.automation).not.toHaveBeenCalled();
  });

  it('carries the marker into the tool docs the model reads', () => {
    const registry = new CapabilityRegistry(ORG).register(eventOnly);
    expect(capabilityDocs(registry)[0]?.description).toContain('EVENT-ONLY');
  });
});

describe('MCP tools', () => {
  /** One MCP tool, registered exactly as a server advertised it. */
  const mcpTool = (definition: McpToolDefinition): Capability => {
    const [tool] = mcpToolsToCapabilities('figma', [definition]);
    if (!tool) throw new Error('expected one capability per tool definition');
    return tool;
  };

  it('treats a tool with no output schema as unstructured', async () => {
    const tool = mcpTool({
      name: 'get_file',
      description: 'Read a Figma file.',
    });

    expect(isUnstructured(tool)).toBe(true);

    const { surface: s } = surface({}, [tool]);
    const result = await s.invokeCapability({ id: 'mcp.figma.get_file' });

    expect(result).toMatchObject({ status: 'ok', structured: false });
  });

  it('still validates the input of an unstructured tool', async () => {
    const tool = mcpTool({
      name: 'get_file',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
      },
    });
    const { surface: s, calls } = surface({}, [tool]);

    await expect(
      s.invokeCapability({ id: 'mcp.figma.get_file', input: {} }),
    ).resolves.toMatchObject({ status: 'refused' });
    expect(calls.mcp).not.toHaveBeenCalled();
  });

  it('marks a tool that declares an output schema as structured', async () => {
    const tool = mcpTool({
      name: 'get_file',
      outputSchema: { type: 'string' },
    });
    const { surface: s } = surface({}, [tool]);

    await expect(
      s.invokeCapability({ id: 'mcp.figma.get_file' }),
    ).resolves.toMatchObject({ status: 'ok', structured: true });
  });

  it('reports a declared output schema that the result does not satisfy', async () => {
    const tool = mcpTool({
      name: 'get_file',
      outputSchema: { type: 'number' },
    });
    const { surface: s } = surface({}, [tool]);

    const result = await s.invokeCapability({ id: 'mcp.figma.get_file' });
    expect(result).toMatchObject({ status: 'ok', output: 'mcp' });
    expect(result).toHaveProperty('schemaViolation', expect.any(String));
  });
});

describe('get_knowledge', () => {
  it('says the backend is unavailable rather than returning an empty result', async () => {
    const { surface: s } = surface();
    await expect(s.getKnowledge({ query: 'refund policy' })).resolves.toEqual({
      status: 'unavailable',
      reason: KNOWLEDGE_UNAVAILABLE_REASON,
    });
    expect(KNOWLEDGE_UNAVAILABLE_REASON).toContain('not');
  });

  it('is a separate method — it never appears in a capability search', () => {
    const { surface: s } = surface();
    expect(
      s.searchCapabilities({ query: 'knowledge' }).map((hit) => hit.id),
    ).not.toContain('get_knowledge');
  });

  it('passes the org and the scope to the backend once one is installed', async () => {
    const search = vi.fn().mockResolvedValue({ status: 'ok', passages: [] });
    const { surface: s } = surface({ knowledge: { search } });

    await s.getKnowledge({ query: 'refund policy', scope: 'private' });

    expect(search).toHaveBeenCalledWith({
      organizationId: ORG,
      query: 'refund policy',
      scope: 'private',
    });
  });
});

describe('memory', () => {
  it('saves as PENDING and records an audit entry', async () => {
    const { surface: s, memory, audit } = surface();

    const result = await s.saveMemory({
      content: '  Prefers email over calls  ',
    });

    expect(result).toMatchObject({ status: 'pending', id: 'mem_1' });
    expect(memory.saved).toEqual([
      {
        organizationId: ORG,
        userId: USER,
        content: 'Prefers email over calls',
        status: 'pending',
        sourceThreadId: 'thread_1',
        sourceMessageId: undefined,
        createdAt: 1_700_000_000_000,
      },
    ]);
    expect(audit).toEqual([
      {
        organizationId: ORG,
        userId: USER,
        action: 'memory.save',
        memoryId: 'mem_1',
        threadId: 'thread_1',
        at: 1_700_000_000_000,
      },
    ]);
  });

  it('refuses an empty memory', async () => {
    const { surface: s, memory } = surface();
    await expect(s.saveMemory({ content: '   ' })).resolves.toMatchObject({
      status: 'refused',
    });
    expect(memory.saved).toEqual([]);
  });

  it('searches approved memories only', async () => {
    const record = (
      id: string,
      status: MemoryRecord['status'],
    ): MemoryRecord => ({
      id,
      organizationId: ORG,
      userId: USER,
      content: id,
      status,
      createdAt: 1,
    });
    const store = fakeMemoryStore([
      record('approved-one', 'approved'),
      record('still-pending', 'pending'),
      record('was-rejected', 'rejected'),
    ]);

    const { surface: s } = surface({ memory: store.store });

    await expect(s.searchMemories({ query: 'anything' })).resolves.toEqual([
      record('approved-one', 'approved'),
    ]);
  });

  it('never returns another organization or user rows', async () => {
    const store = fakeMemoryStore([
      {
        id: 'other-org',
        organizationId: 'org_2',
        userId: USER,
        content: 'leak',
        status: 'approved',
        createdAt: 1,
      },
      {
        id: 'other-user',
        organizationId: ORG,
        userId: 'user_2',
        content: 'leak',
        status: 'approved',
        createdAt: 1,
      },
    ]);
    const { surface: s } = surface({ memory: store.store });

    await expect(s.searchMemories({ query: 'leak' })).resolves.toEqual([]);
  });

  it('is a tool, not an injection — nothing is read unless it is called', async () => {
    const store = fakeMemoryStore([
      {
        id: 'm1',
        organizationId: ORG,
        userId: USER,
        content: 'approved fact',
        status: 'approved',
        createdAt: 1,
      },
    ]);
    const search = vi.spyOn(store.store, 'search');
    const { surface: s } = surface({ memory: store.store });

    s.searchCapabilities({ query: 'anything' });
    await s.invokeCapability({ id: 'builtin.run_code' });

    expect(search).not.toHaveBeenCalled();
  });
});

describe('dispatch', () => {
  it('exposes the same methods behind one entry point', async () => {
    const { surface: s, calls } = surface();

    await expect(
      s.dispatch('search_capabilities', { query: 'run_code' }),
    ).resolves.toMatchObject({
      capabilities: [expect.objectContaining({ id: 'builtin.run_code' })],
    });
    await s.dispatch('invoke_capability', { id: 'builtin.run_code' });
    expect(calls.builtin).toHaveBeenCalled();

    await expect(s.dispatch('memory.search', { query: 'x' })).resolves.toEqual({
      memories: [],
    });
  });

  it('names the available methods when asked for one that does not exist', async () => {
    const { surface: s } = surface();
    await expect(s.dispatch('run_workflow', {})).resolves.toMatchObject({
      error: 'unknown method "run_workflow"',
    });
  });
});

describe('createIntegrationBackend', () => {
  it('always calls the integrations dispatcher as the user, in their org', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'ok',
      connector: 'github',
      action: 'list_issues',
      nodeType: 'github.list_issues',
      mode: 'live',
      backend: 'yaml-js',
      effects: 'read',
      output: { issues: [] },
    });
    const backend = createIntegrationBackend({
      ctx: { mode: 'live' },
      execute,
    });

    await expect(
      backend({
        organizationId: ORG,
        userId: USER,
        connector: 'github',
        action: 'list_issues',
        input: { owner: 'tale' },
        credentialRef: 'cred_1',
      }),
    ).resolves.toEqual({ status: 'ok', output: { issues: [] } });

    expect(execute).toHaveBeenCalledWith({
      connector: 'github',
      action: 'list_issues',
      input: { owner: 'tale' },
      credentialRef: 'cred_1',
      caller: { kind: 'user', userId: USER },
      ctx: { mode: 'live', organizationId: ORG },
    });
  });

  it('turns an approval requirement into a refusal the model can explain', async () => {
    const execute = vi.fn().mockResolvedValue({
      status: 'approval-required',
      connector: 'github',
      action: 'create_issue',
      nodeType: 'github.create_issue',
      message: 'Creating an issue needs approval.',
    });
    const backend = createIntegrationBackend({ ctx: {}, execute });

    await expect(
      backend({
        organizationId: ORG,
        userId: USER,
        connector: 'github',
        action: 'create_issue',
        input: {},
      }),
    ).resolves.toMatchObject({
      status: 'refused',
      reason: 'Creating an issue needs approval.',
    });
  });
});
