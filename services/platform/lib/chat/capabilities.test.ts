import { describe, expect, it, vi } from 'vitest';

import {
  CAPABILITY_KINDS,
  CapabilityRegistry,
  createCapabilitySurface,
  isUnstructured,
  type Capability,
  type CapabilityAuditEntry,
  type CapabilityBackends,
  type CapabilitySurfaceDeps,
  type MemoryRecord,
  type MemorySaveRequest,
  type MemoryStore,
} from './capabilities';

/**
 * The surface's promises: one registry of the org's deployed automations,
 * one dispatcher that validates the input and sends the call to the
 * automations backend, a memory tool that can only ever propose, and a
 * knowledge method that is a separate question from finding a capability.
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
    kind: 'automation',
    id: 'automation.github/triage-issues',
    name: 'Triage GitHub issues',
    description: 'Score open issues and rank the ones ready to be worked.',
    tags: ['github', 'issues'],
    inputSchema: objectSchema({ dry: { type: 'boolean' } }),
    automation: 'github/triage-issues',
    ...overrides,
  };
}

function fakeBackends(): {
  backends: CapabilityBackends;
  calls: Record<keyof CapabilityBackends, ReturnType<typeof vi.fn>>;
} {
  const calls = {
    automation: vi
      .fn()
      .mockResolvedValue({ status: 'ok', output: 'automation' }),
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
    knowledge: {
      search: () => Promise.resolve({ status: 'ok', passages: [] }),
    },
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

const catalog: Capability[] = [
  capability(),
  capability({
    id: 'automation.sales/daily-digest',
    name: 'Daily sales digest',
    description: 'Send the daily pipeline digest to the sales channel.',
    tags: ['sales', 'digest'],
    automation: 'sales/daily-digest',
  }),
  capability({
    id: 'automation/release-notes',
    name: 'Write release notes',
    description:
      'How this team writes release notes from merged pull requests.',
    tags: [],
    automation: 'release-notes',
    outputSchema: { type: 'string' },
  }),
];

describe('CapabilityRegistry', () => {
  it('is bound to one organization and refuses a surface for another', () => {
    const registry = new CapabilityRegistry('org_other');
    expect(() =>
      createCapabilitySurface({
        organizationId: ORG,
        userId: USER,
        registry,
        backends: fakeBackends().backends,
        knowledge: {
          search: () => Promise.resolve({ status: 'ok', passages: [] }),
        },
        memory: fakeMemoryStore().store,
        audit: { record: () => Promise.resolve() },
      }),
    ).toThrow(/different organization/);
  });

  it('refuses two capabilities answering to one id', () => {
    const registry = new CapabilityRegistry(ORG).register(capability());
    expect(() =>
      registry.register(capability({ automation: 'github/triage-issues-v2' })),
    ).toThrow(/registered twice/);
  });
});

describe('search_capabilities', () => {
  it('ranks by relevance and reports whether a hit is structured', () => {
    const { surface: s } = surface({}, catalog);
    const hits = s.searchCapabilities({ query: 'sales digest' });

    expect(hits[0]?.id).toBe('automation.sales/daily-digest');
    // No declared output schema, so the model is told the result is whatever
    // the automation returned.
    expect(hits[0]?.structured).toBe(false);
    expect(
      s.searchCapabilities({ query: 'release notes' })[0]?.structured,
    ).toBe(true);
  });

  it('finds a capability by its description, not just its id', () => {
    const { surface: s } = surface({}, catalog);
    expect(
      s
        .searchCapabilities({ query: 'merged pull requests' })
        .map((hit) => hit.id),
    ).toContain('automation/release-notes');
  });

  it('names the one registered kind on every hit', () => {
    const { surface: s } = surface({}, catalog);
    const kinds = new Set(
      s.searchCapabilities({ query: 'issues digest notes' }).map((h) => h.kind),
    );
    expect(kinds).toEqual(new Set(CAPABILITY_KINDS));
  });

  it('returns nothing rather than an arbitrary tail when nothing matches', () => {
    const { surface: s } = surface({}, catalog);
    expect(
      s.searchCapabilities({ query: 'quarterly revenue forecast' }),
    ).toEqual([]);
  });
});

describe('invoke_capability', () => {
  it('dispatches an automation to the automations backend as the user, in their org', async () => {
    const { surface: s, calls } = surface({}, catalog);
    await expect(
      s.invokeCapability({
        id: 'automation.github/triage-issues',
        input: { dry: true },
      }),
    ).resolves.toMatchObject({
      status: 'ok',
      kind: 'automation',
      output: 'automation',
    });
    expect(calls.automation).toHaveBeenCalledWith({
      organizationId: ORG,
      userId: USER,
      automation: 'github/triage-issues',
      input: { dry: true },
    });
  });

  it('validates the input before any backend runs', async () => {
    const { surface: s, calls } = surface({}, [
      capability({
        inputSchema: {
          type: 'object',
          properties: { dry: { type: 'boolean' } },
          required: ['dry'],
        },
      }),
    ]);

    const result = await s.invokeCapability({
      id: 'automation.github/triage-issues',
      input: { dry: 'yes' },
    });

    expect(result).toMatchObject({ status: 'refused' });
    expect(calls.automation).not.toHaveBeenCalled();
  });

  it('refuses an unknown id with a suggestion instead of guessing', async () => {
    const { surface: s } = surface({}, catalog);
    const result = await s.invokeCapability({
      id: 'automation.github/triage-issue',
    });
    expect(result).toMatchObject({
      status: 'refused',
      hint: 'Did you mean "automation.github/triage-issues"?',
    });
  });

  it('passes a backend refusal through with its hint', async () => {
    const refusing: CapabilityBackends = {
      automation: vi.fn().mockResolvedValue({
        status: 'refused',
        reason: 'Approval required.',
        hint: 'Ask an admin.',
      }),
    };
    const { surface: s } = surface({ backends: refusing }, catalog);

    await expect(
      s.invokeCapability({ id: 'automation.github/triage-issues' }),
    ).resolves.toMatchObject({
      status: 'refused',
      reason: 'Approval required.',
      hint: 'Ask an admin.',
    });
  });

  it('treats a capability with no output schema as unstructured', async () => {
    const { surface: s } = surface({}, catalog);
    expect(isUnstructured(catalog[0]!)).toBe(true);
    await expect(
      s.invokeCapability({ id: 'automation.github/triage-issues' }),
    ).resolves.toMatchObject({ status: 'ok', structured: false });
  });

  it('marks a capability that declares an output schema as structured', async () => {
    const { surface: s } = surface({}, catalog);
    await expect(
      s.invokeCapability({ id: 'automation/release-notes' }),
    ).resolves.toMatchObject({ status: 'ok', structured: true });
  });

  it('reports a declared output schema that the result does not satisfy', async () => {
    const { surface: s } = surface({}, [
      capability({ outputSchema: { type: 'number' } }),
    ]);

    const result = await s.invokeCapability({
      id: 'automation.github/triage-issues',
    });
    expect(result).toMatchObject({ status: 'ok', output: 'automation' });
    expect(result).toHaveProperty('schemaViolation', expect.any(String));
  });
});

describe('get_knowledge', () => {
  it('is a separate method — it never appears in a capability search', () => {
    const { surface: s } = surface();
    expect(
      s.searchCapabilities({ query: 'knowledge' }).map((hit) => hit.id),
    ).not.toContain('get_knowledge');
  });

  it('passes the org, the corpus and the limit to the backend', async () => {
    const search = vi.fn().mockResolvedValue({ status: 'ok', passages: [] });
    const { surface: s } = surface({ knowledge: { search } });

    await s.getKnowledge({
      query: 'refund policy',
      corpus: 'private',
      limit: 3,
    });

    expect(search).toHaveBeenCalledWith({
      organizationId: ORG,
      query: 'refund policy',
      corpus: 'private',
      limit: 3,
    });
  });

  it('passes an unavailable-with-reason answer through untouched', async () => {
    const unavailable = {
      status: 'unavailable' as const,
      reason: 'index offline',
    };
    const { surface: s } = surface({
      knowledge: { search: () => Promise.resolve(unavailable) },
    });
    await expect(s.getKnowledge({ query: 'refund policy' })).resolves.toEqual(
      unavailable,
    );
  });

  it('reads the corpus and limit off a dispatched call', async () => {
    const search = vi.fn().mockResolvedValue({ status: 'ok', passages: [] });
    const { surface: s } = surface({ knowledge: { search } });

    await s.dispatch('get_knowledge', {
      query: 'refund policy',
      corpus: 'public-web',
      limit: 5,
    });

    expect(search).toHaveBeenCalledWith({
      organizationId: ORG,
      query: 'refund policy',
      corpus: 'public-web',
      limit: 5,
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
    await s.invokeCapability({ id: 'automation.github/triage-issues' });

    expect(search).not.toHaveBeenCalled();
  });
});

describe('dispatch', () => {
  it('exposes the same methods behind one entry point', async () => {
    const { surface: s, calls } = surface();

    await expect(
      s.dispatch('search_capabilities', { query: 'triage issues' }),
    ).resolves.toMatchObject({
      capabilities: [
        expect.objectContaining({ id: 'automation.github/triage-issues' }),
      ],
    });
    await s.dispatch('invoke_capability', {
      id: 'automation.github/triage-issues',
    });
    expect(calls.automation).toHaveBeenCalled();

    await expect(s.dispatch('memory.search', { query: 'x' })).resolves.toEqual({
      memories: [],
    });
  });

  it('names the available methods when asked for one that does not exist', async () => {
    const { surface: s } = surface();
    // An engine method is not a chat capability method: the two surfaces are
    // separate tables, and asking this one for the other's method fails.
    await expect(s.dispatch('run_automation', {})).resolves.toMatchObject({
      error: 'unknown method "run_automation"',
    });
  });
});
