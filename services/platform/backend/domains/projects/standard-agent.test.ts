// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ComposerModelOption } from '../../core/chat/composer.ts';

const {
  readGovernancePolicyForOrg,
  listGovernedChatModels,
  listProjectSkillSlugs,
  alignManagedProjectAgent,
  insertManagedProjectAgent,
  loadProjectOrThrow,
} = vi.hoisted(() => ({
  readGovernancePolicyForOrg: vi.fn(),
  listGovernedChatModels: vi.fn(),
  listProjectSkillSlugs: vi.fn(),
  alignManagedProjectAgent: vi.fn(),
  insertManagedProjectAgent: vi.fn(),
  loadProjectOrThrow: vi.fn(),
}));

vi.mock('../../lib/org-config.ts', () => ({ readGovernancePolicyForOrg }));
vi.mock('../chat/composer.ts', () => ({
  listGovernedChatModels,
  listProjectSkillSlugs,
}));
// Wholly stood in, never `importOriginal`: the real service reaches the kick
// through the task domain (retire → agent runs → this module), and loading
// it here would bind this module to the unmocked service.
vi.mock('./service.ts', () => {
  class ProjectError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status = 400,
      readonly data?: Record<string, unknown>,
    ) {
      super(message);
    }
  }
  return {
    ProjectError,
    alignManagedProjectAgent,
    insertManagedProjectAgent,
    loadProjectOrThrow,
    assertReadable: () => undefined,
    assertProjectActive: (project: { archivedAt: number | null }) => {
      if (project.archivedAt !== null) {
        throw new ProjectError('PROJECT_ARCHIVED', 'Project is archived', 403);
      }
    },
    eligibleProjectAgentHarnesses: () => ['claude-code', 'codex', 'opencode'],
  };
});

import { ProjectError } from './service.ts';
import {
  chooseStandardAgentServing,
  ensureStandardAgent,
  readStandardAgentAvailability,
  STANDARD_AGENT_DEFAULT_INSTRUCTIONS,
  standardAgentServingForKick,
} from './standard-agent.ts';

const ELIGIBLE = ['claude-code', 'codex', 'opencode'];
// The shipped harness that speaks the Responses API.
const RESPONSES_SPEAKERS: ReadonlySet<string> = new Set(['codex']);

function option(
  id: string,
  providerSlug: string,
  overrides: Partial<ComposerModelOption> = {},
): ComposerModelOption {
  return {
    id,
    label: id,
    providerSlug,
    providerLabel: providerSlug,
    credential: { authMethod: 'api-key' },
    tools: true,
    contextWindow: 200_000,
    pricing: { inputCentsPerMillion: 100, outputCentsPerMillion: 500 },
    tags: ['chat'],
    ...overrides,
  };
}

function subscription(
  id: string,
  providerSlug: string,
  harness: string,
): ComposerModelOption {
  return option(id, providerSlug, {
    credential: {
      authMethod: 'subscription-key',
      constraints: { harness, execution: 'sandbox' },
    },
  });
}

describe('chooseStandardAgentServing — what runs the standard agent', () => {
  it('runs automatically on Claude Code with the chat Auto choice for document work', () => {
    const serving = chooseStandardAgentServing(
      [
        option('cheap-model', 'openrouter', {
          pricing: { inputCentsPerMillion: 1, outputCentsPerMillion: 2 },
        }),
        option('claude-sonnet-5', 'anthropic'),
      ],
      {},
      ELIGIBLE,
      RESPONSES_SPEAKERS,
    );

    expect(serving).toEqual({
      ok: true,
      harness: 'claude-code',
      model: 'claude-sonnet-5',
      modelProvider: 'anthropic',
      source: 'preferred',
    });
  });

  it('falls back to the cheapest servable model when no curated one is reachable', () => {
    const serving = chooseStandardAgentServing(
      [
        option('pricey', 'acme', {
          pricing: { inputCentsPerMillion: 100, outputCentsPerMillion: 900 },
        }),
        option('modest', 'acme', {
          pricing: { inputCentsPerMillion: 10, outputCentsPerMillion: 40 },
        }),
      ],
      {},
      ELIGIBLE,
      RESPONSES_SPEAKERS,
    );

    expect(serving).toMatchObject({
      ok: true,
      model: 'modest',
      source: 'cheapest',
    });
  });

  it('runs a subscription-only organization on the runtime its subscription is bound to', () => {
    const serving = chooseStandardAgentServing(
      [subscription('gpt-5.5', 'openai', 'codex')],
      {},
      ELIGIBLE,
      RESPONSES_SPEAKERS,
    );

    expect(serving).toMatchObject({
      ok: true,
      harness: 'codex',
      model: 'gpt-5.5',
      modelProvider: 'openai',
    });
  });

  it('keeps a pinned runtime and chooses among what it can run', () => {
    const serving = chooseStandardAgentServing(
      [
        subscription('claude-sonnet-5', 'anthropic', 'claude-code'),
        option('gpt-5.5', 'openai'),
      ],
      { harness: 'codex' },
      ELIGIBLE,
      RESPONSES_SPEAKERS,
    );

    expect(serving).toMatchObject({
      ok: true,
      harness: 'codex',
      model: 'gpt-5.5',
    });
  });

  it('uses a pinned model as pinned — on the default runtime, or the one its subscription needs', () => {
    expect(
      chooseStandardAgentServing(
        [option('gpt-5.5', 'openai'), option('claude-sonnet-5', 'anthropic')],
        { providerSlug: 'openai', modelId: 'gpt-5.5' },
        ELIGIBLE,
        RESPONSES_SPEAKERS,
      ),
    ).toEqual({
      ok: true,
      harness: 'claude-code',
      model: 'gpt-5.5',
      modelProvider: 'openai',
      source: 'pinned',
    });
    expect(
      chooseStandardAgentServing(
        [subscription('gpt-5.5', 'openai', 'codex')],
        { providerSlug: 'openai', modelId: 'gpt-5.5' },
        ELIGIBLE,
        RESPONSES_SPEAKERS,
      ),
    ).toMatchObject({ ok: true, harness: 'codex', source: 'pinned' });
  });

  it('runs a Responses-only model only on a runtime that speaks the Responses API', () => {
    const responsesOnly = option('gpt-6.1-sol', 'openai', {
      toolCallingApi: 'responses',
      pricing: { inputCentsPerMillion: 1, outputCentsPerMillion: 1 },
    });
    const speakers = new Set(['codex']);
    // Pinned with no runtime: the default runtime cannot carry its tools,
    // so the first one that can runs it.
    expect(
      chooseStandardAgentServing(
        [responsesOnly],
        { providerSlug: 'openai', modelId: 'gpt-6.1-sol' },
        ELIGIBLE,
        speakers,
      ),
    ).toEqual({
      ok: true,
      harness: 'codex',
      model: 'gpt-6.1-sol',
      modelProvider: 'openai',
      source: 'pinned',
    });
    // Pinned onto a runtime that cannot carry it: refused, never swapped.
    expect(
      chooseStandardAgentServing(
        [responsesOnly],
        { harness: 'opencode', providerSlug: 'openai', modelId: 'gpt-6.1-sol' },
        ELIGIBLE,
        speakers,
      ),
    ).toEqual({ ok: false, refusal: 'pin-unavailable' });
    // Automatic on the default runtime: the cheaper Responses-only model is
    // passed over for one the default runtime can run.
    expect(
      chooseStandardAgentServing(
        [responsesOnly, option('modest', 'acme')],
        {},
        ELIGIBLE,
        speakers,
      ),
    ).toMatchObject({ ok: true, harness: 'claude-code', model: 'modest' });
    // Without any runtime that speaks it, nothing runs it.
    expect(
      chooseStandardAgentServing(
        [responsesOnly],
        { providerSlug: 'openai', modelId: 'gpt-6.1-sol' },
        ELIGIBLE,
        new Set(),
      ),
    ).toEqual({ ok: false, refusal: 'pin-unavailable' });
  });

  it('refuses a pin it cannot run, and never swaps in another model', () => {
    expect(
      chooseStandardAgentServing(
        [option('claude-sonnet-5', 'anthropic')],
        { providerSlug: 'openai', modelId: 'gpt-5.5' },
        ELIGIBLE,
        RESPONSES_SPEAKERS,
      ),
    ).toEqual({ ok: false, refusal: 'pin-unavailable' });
    expect(
      chooseStandardAgentServing(
        [subscription('claude-sonnet-5', 'anthropic', 'claude-code')],
        {
          harness: 'codex',
          providerSlug: 'anthropic',
          modelId: 'claude-sonnet-5',
        },
        ELIGIBLE,
        RESPONSES_SPEAKERS,
      ),
    ).toEqual({ ok: false, refusal: 'pin-unavailable' });
  });

  it('refuses a runtime a project agent may not use, and an organization with nothing to run', () => {
    expect(
      chooseStandardAgentServing(
        [option('gpt-5.5', 'openai')],
        { harness: 'cursor' },
        ELIGIBLE,
        RESPONSES_SPEAKERS,
      ),
    ).toEqual({ ok: false, refusal: 'harness-invalid' });
    expect(
      chooseStandardAgentServing([], {}, ELIGIBLE, RESPONSES_SPEAKERS),
    ).toEqual({
      ok: false,
      refusal: 'no-model',
    });
    expect(
      chooseStandardAgentServing(
        [subscription('claude-sonnet-5', 'anthropic', 'claude-code')],
        { harness: 'codex' },
        ELIGIBLE,
        RESPONSES_SPEAKERS,
      ),
    ).toEqual({ ok: false, refusal: 'no-model' });
  });
});

/** A transaction stand-in answering the module's few reads by their text. */
function fakeTx(answer: (query: string) => unknown[]) {
  const queries: string[] = [];
  const tx = (strings: TemplateStringsArray) => {
    const query = strings.join('?');
    queries.push(query);
    return Promise.resolve(answer(query));
  };
  return { tx: tx as never, queries };
}

beforeEach(() => {
  vi.clearAllMocks();
  listGovernedChatModels.mockResolvedValue([
    option('claude-sonnet-5', 'anthropic'),
  ]);
});

// The availability every picker reads and the kick a start runs choose with
// the same runtimes: a ChatGPT subscription's Responses-only model, pinned,
// runs on Codex in both, never available in one and refused by the other.
describe('readStandardAgentAvailability — agrees with the kick', () => {
  it('reports a Responses-only subscription pin as available on Codex', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({
      enabled: true,
      providerSlug: 'openai',
      modelId: 'gpt-6.1-sol',
    });
    listGovernedChatModels.mockResolvedValue([
      option('gpt-6.1-sol', 'openai', {
        toolCallingApi: 'responses',
        credential: {
          authMethod: 'subscription-broker',
          constraints: { harness: 'codex', execution: 'sandbox' },
        },
      }),
    ]);

    await expect(
      readStandardAgentAvailability({} as never, {
        organizationId: 'org-1',
        userId: 'member-1',
      }),
    ).resolves.toMatchObject({
      enabled: true,
      available: true,
      harness: 'codex',
      model: 'gpt-6.1-sol',
      modelProvider: 'openai',
      source: 'pinned',
    });
  });
});

describe('standardAgentServingForKick — the policy, at every start', () => {
  const args = {
    organizationId: 'org-1',
    agentId: 'agent-1',
    startedBy: 'member-1',
    harness: 'codex',
    model: 'stale-model',
    modelProvider: 'openai',
  };
  const managedRow = (query: string) =>
    query.includes('FROM app.project_agents')
      ? [{ managed: true, projectId: 'project-1', createdBy: 'editor-1' }]
      : [];
  // The project can equip two of the four document skills now — an admin
  // disabled the others since the agent was set up.
  beforeEach(() => {
    listProjectSkillSlugs.mockResolvedValue(['xlsx', 'house-style', 'docx']);
  });

  it('starts any other agent exactly as its caller read it', async () => {
    const { tx } = fakeTx((query) =>
      query.includes('FROM app.project_agents')
        ? [{ managed: false, projectId: 'project-1', createdBy: 'editor-1' }]
        : [],
    );

    await expect(standardAgentServingForKick(tx, args)).resolves.toEqual({
      harness: 'codex',
      model: 'stale-model',
      modelProvider: 'openai',
    });
    expect(readGovernancePolicyForOrg).not.toHaveBeenCalled();
    expect(alignManagedProjectAgent).not.toHaveBeenCalled();
  });

  it('runs the standard agent on what the policy says now, for the starter, and writes it back', async () => {
    readGovernancePolicyForOrg.mockResolvedValue(null);
    const { tx } = fakeTx(managedRow);

    await expect(standardAgentServingForKick(tx, args)).resolves.toEqual({
      harness: 'claude-code',
      model: 'claude-sonnet-5',
      modelProvider: 'anthropic',
    });
    expect(listGovernedChatModels).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      userId: 'member-1',
    });
    expect(alignManagedProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      { id: 'agent-1', organizationId: 'org-1', projectId: 'project-1' },
      {
        harness: 'claude-code',
        model: 'claude-sonnet-5',
        modelProvider: 'anthropic',
        skills: ['docx', 'xlsx'],
        instructions: STANDARD_AGENT_DEFAULT_INSTRUCTIONS,
      },
    );
  });

  it('resolves a scheduled start for the agent’s creator, and carries the policy’s instructions', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({
      enabled: true,
      instructions: 'Use the house style.',
    });
    const { tx } = fakeTx(managedRow);

    await standardAgentServingForKick(tx, {
      ...args,
      startedBy: 'trigger:nightly',
    });

    expect(listGovernedChatModels).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      userId: 'editor-1',
    });
    expect(alignManagedProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ instructions: 'Use the house style.' }),
    );
  });

  it('refuses while switched off, and names why it cannot run otherwise', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({ enabled: false });
    const off = await standardAgentServingForKick(
      fakeTx(managedRow).tx,
      args,
    ).catch((error: unknown) => error);
    expect(off).toBeInstanceOf(ProjectError);
    expect(off).toMatchObject({ code: 'STANDARD_AGENT_OFF', status: 403 });

    readGovernancePolicyForOrg.mockResolvedValue({
      enabled: true,
      providerSlug: 'openai',
      modelId: 'gpt-5.5',
    });
    const pinned = await standardAgentServingForKick(
      fakeTx(managedRow).tx,
      args,
    ).catch((error: unknown) => error);
    expect(pinned).toMatchObject({
      code: 'STANDARD_AGENT_UNAVAILABLE',
      status: 409,
      data: { reason: 'pin-unavailable' },
    });
    expect(alignManagedProjectAgent).not.toHaveBeenCalled();
  });

  it('refuses a policy file it cannot read instead of reading it as on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    readGovernancePolicyForOrg.mockRejectedValue(new Error('malformed'));

    await expect(
      standardAgentServingForKick(fakeTx(managedRow).tx, args),
    ).rejects.toMatchObject({
      code: 'STANDARD_AGENT_UNAVAILABLE',
      data: { reason: 'unreadable' },
    });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('ensureStandardAgent — the door a Member hands a project work through', () => {
  const auth = {
    organizationId: 'org-1',
    userId: 'member-1',
    role: 'member',
    teamIds: [],
  };

  beforeEach(() => {
    loadProjectOrThrow.mockResolvedValue({
      id: 'project-1',
      organizationId: 'org-1',
      name: 'Getting started',
      archivedAt: null,
      teamIds: [],
    });
    listProjectSkillSlugs.mockResolvedValue(['pdf', 'brief-summary', 'docx']);
    insertManagedProjectAgent.mockResolvedValue({
      agentId: 'agent-new',
      created: true,
    });
  });

  it('creates it in a project without agents, with the document skills the project sees and a name in the organization’s language', async () => {
    readGovernancePolicyForOrg.mockResolvedValue(null);
    const { tx } = fakeTx((query) =>
      query.includes('FROM "organization"')
        ? [{ metadata: { defaultLocale: 'de' } }]
        : [],
    );

    await expect(ensureStandardAgent(tx, auth, 'project-1')).resolves.toEqual({
      agentId: 'agent-new',
      created: true,
    });
    expect(insertManagedProjectAgent).toHaveBeenCalledWith(
      expect.anything(),
      auth,
      expect.objectContaining({ id: 'project-1' }),
      {
        name: 'Standard-Agent',
        harness: 'claude-code',
        model: 'claude-sonnet-5',
        modelProvider: 'anthropic',
        skills: ['docx', 'pdf'],
        instructions: STANDARD_AGENT_DEFAULT_INSTRUCTIONS,
      },
    );
    // What the project itself can equip, not the member's visibility, in
    // the document skills' own order.
    expect(listProjectSkillSlugs).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      projectId: 'project-1',
    });
  });

  it('answers the standing standard agent, and leaves a project with its own agents to them', async () => {
    const standing = fakeTx((query) =>
      query.includes('FROM app.project_agents')
        ? [{ id: 'agent-standing', managed: true }]
        : [],
    );
    await expect(
      ensureStandardAgent(standing.tx, auth, 'project-1'),
    ).resolves.toEqual({ agentId: 'agent-standing', created: false });

    const curated = fakeTx((query) =>
      query.includes('FROM app.project_agents')
        ? [{ id: 'agent-curated', managed: false }]
        : [],
    );
    await expect(
      ensureStandardAgent(curated.tx, auth, 'project-1'),
    ).rejects.toMatchObject({ code: 'STANDARD_AGENT_NOT_NEEDED', status: 409 });
    expect(insertManagedProjectAgent).not.toHaveBeenCalled();
  });

  it('creates nothing while the organization switched it off', async () => {
    readGovernancePolicyForOrg.mockResolvedValue({ enabled: false });

    await expect(
      ensureStandardAgent(fakeTx(() => []).tx, auth, 'project-1'),
    ).rejects.toMatchObject({ code: 'STANDARD_AGENT_OFF' });
    expect(insertManagedProjectAgent).not.toHaveBeenCalled();
  });

  it('refuses an archived project', async () => {
    loadProjectOrThrow.mockResolvedValue({
      id: 'project-1',
      organizationId: 'org-1',
      name: 'Getting started',
      archivedAt: 1,
      teamIds: [],
    });

    await expect(
      ensureStandardAgent(fakeTx(() => []).tx, auth, 'project-1'),
    ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
  });
});
