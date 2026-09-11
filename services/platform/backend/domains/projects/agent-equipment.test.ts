// @vitest-environment node

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A project agent is equipped from the same listings the dialog offers.
 * The regressions under test: a model the organization cannot call, or a
 * provider that does not exist, was stored with a 201 and failed
 * unattended at the first task start; a tool grant outside the catalog was
 * dropped to nothing in silence; a skill or connector nobody had was stored
 * verbatim.
 */

const composer = vi.hoisted(() => ({
  listComposerModels: vi.fn(),
  listProjectCapabilities: vi.fn(),
}));

vi.mock('../chat/composer.ts', () => composer);

const { agentEquipmentRefusal, agentModelRefusal, unknownToolGrants } =
  await import('./agent-equipment.ts');

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- never queried: the listings are mocked
const sql = {} as Sql;
const org = { organizationId: 'org-1', userId: 'user-1' };

beforeEach(() => {
  vi.clearAllMocks();
  composer.listComposerModels.mockResolvedValue({
    models: [
      {
        id: 'glm-5.3',
        label: 'GLM 5.3',
        providerSlug: 'zai',
        providerLabel: 'Z.ai',
        credential: { authMethod: 'api-key' },
        tools: true,
        contextWindow: 128_000,
        tags: ['chat'],
      },
      {
        id: 'claude-sonnet-5',
        label: 'Claude Sonnet 5',
        providerSlug: 'anthropic',
        providerLabel: 'Anthropic',
        credential: {
          authMethod: 'subscription-key',
          constraints: { execution: 'sandbox', harness: 'claude-code' },
        },
        tools: true,
        contextWindow: 200_000,
        tags: ['chat'],
      },
    ],
    harnesses: [],
    voice: { ttsAvailable: false, transcriptionAvailable: false },
  });
  composer.listProjectCapabilities.mockResolvedValue({
    skills: [{ slug: 'docx', label: 'docx' }],
    connectors: [{ slug: 'github', label: 'GitHub' }],
  });
});

describe('agentModelRefusal', () => {
  it('accepts a listed pair, and a listed id without a provider', async () => {
    await expect(
      agentModelRefusal(sql, {
        ...org,
        harness: 'pi',
        model: 'glm-5.3',
        modelProvider: 'zai',
      }),
    ).resolves.toBeNull();
    await expect(
      agentModelRefusal(sql, { ...org, harness: 'pi', model: 'glm-5.3' }),
    ).resolves.toBeNull();
  });

  it('refuses a provider the organization has no credential for', async () => {
    await expect(
      agentModelRefusal(sql, {
        ...org,
        harness: 'pi',
        model: 'glm-5.3',
        modelProvider: 'not-a-real-provider',
      }),
    ).resolves.toMatchObject({ code: 'PROJECT_AGENT_PROVIDER_UNKNOWN' });
  });

  it('refuses a model the organization cannot call, naming the listing', async () => {
    const refusal = await agentModelRefusal(sql, {
      ...org,
      harness: 'pi',
      model: 'gpt-4-turbo-does-not-exist',
    });
    expect(refusal).toMatchObject({ code: 'PROJECT_AGENT_MODEL_INVALID' });
    expect(refusal?.message).toContain('GET /api/v1/models');
    await expect(
      agentModelRefusal(sql, {
        ...org,
        harness: 'pi',
        model: 'glm-5.3',
        modelProvider: 'anthropic',
      }),
    ).resolves.toMatchObject({ code: 'PROJECT_AGENT_MODEL_INVALID' });
  });

  it('holds a subscription-served model to the harness its credential is bound to', async () => {
    await expect(
      agentModelRefusal(sql, {
        ...org,
        harness: 'claude-code',
        model: 'claude-sonnet-5',
      }),
    ).resolves.toBeNull();
    const refusal = await agentModelRefusal(sql, {
      ...org,
      harness: 'pi',
      model: 'claude-sonnet-5',
    });
    expect(refusal).toMatchObject({ code: 'PROJECT_AGENT_MODEL_INVALID' });
    expect(refusal?.message).toContain('claude-code');
  });
});

describe('agentEquipmentRefusal', () => {
  it('skips the listing when nothing is named', async () => {
    await expect(
      agentEquipmentRefusal(sql, {
        ...org,
        projectId: 'p-1',
        skills: [],
        connectors: [],
      }),
    ).resolves.toBeNull();
    expect(composer.listProjectCapabilities).not.toHaveBeenCalled();
  });

  it('accepts what the project can see and refuses the rest by name', async () => {
    await expect(
      agentEquipmentRefusal(sql, {
        ...org,
        projectId: 'p-1',
        skills: ['docx'],
        connectors: ['github'],
      }),
    ).resolves.toBeNull();
    const skill = await agentEquipmentRefusal(sql, {
      ...org,
      projectId: 'p-1',
      skills: ['docx', 'not-a-real-skill-xyz'],
      connectors: [],
    });
    expect(skill).toMatchObject({ code: 'PROJECT_AGENT_SKILL_UNKNOWN' });
    expect(skill?.message).toContain('not-a-real-skill-xyz');
    const connector = await agentEquipmentRefusal(sql, {
      ...org,
      projectId: 'p-1',
      skills: [],
      connectors: ['not-a-real-connector-xyz'],
    });
    expect(connector).toMatchObject({
      code: 'PROJECT_AGENT_CONNECTOR_UNKNOWN',
    });
    expect(connector?.message).toContain('github');
  });
});

describe('unknownToolGrants', () => {
  it('names every grant outside the catalog, once, and nothing inside it', () => {
    expect(
      unknownToolGrants(['task_find', 'bash', 'web_search', 'bash']),
    ).toEqual(['bash', 'web_search']);
    expect(unknownToolGrants(['task_find', 'document_create'])).toEqual([]);
  });
});
