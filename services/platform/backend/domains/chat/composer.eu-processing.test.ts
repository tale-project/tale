import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelEndpointPolicy } from '../../core/governance/model_endpoint_gate.ts';
import {
  walkChatCatalog,
  type ChatCatalogHit,
} from '../../core/lib/providers/chat_catalog.ts';
import { inspectTranscriptionModels } from '../../core/lib/providers/resolve_transcription_model.ts';
import { readModelEndpointPolicyForOrg } from '../governance/model-endpoints.ts';
import {
  getAccessibleModelsForMembers,
  getAccessibleModelsForUser,
} from '../governance/service.ts';
import { listServingCredentialFacts } from '../provider_credentials/service.ts';
import {
  listComposerModels,
  listGovernedChatModels,
  listOrganizationChatModels,
} from './composer.ts';

// The walk is faked; the EU/EEA filter over its hits stays the real one.
vi.mock('../../core/lib/providers/chat_catalog.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../core/lib/providers/chat_catalog.ts')
  >()),
  walkChatCatalog: vi.fn(),
}));
vi.mock('../../core/lib/providers/resolve_transcription_model.ts', () => ({
  inspectTranscriptionModels: vi.fn(),
}));
vi.mock('../governance/model-endpoints.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../governance/model-endpoints.ts')
  >()),
  readModelEndpointPolicyForOrg: vi.fn(),
}));
vi.mock('../governance/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../governance/service.ts')>()),
  getAccessibleModelsForMembers: vi.fn(),
  getAccessibleModelsForUser: vi.fn(),
}));
vi.mock('../provider_credentials/service.ts', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../provider_credentials/service.ts')
  >()),
  listServingCredentialFacts: vi.fn(),
}));

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the walk that reads it is faked
const SQL = {} as Sql;
const ARGS = { organizationId: 'org-1', userId: 'user-1' };

/** A model the walk found, served through `baseUrl` — the endpoint the
 * EU/EEA rule judges. */
function hit(
  provider: string,
  id: string,
  baseUrl: string,
  tags: string[] = ['chat'],
): ChatCatalogHit {
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the listing reads only these connector fields
    connector: {
      name: provider,
      displayName: provider,
      baseUrl,
    } as unknown as ChatCatalogHit['connector'],
    credential: { providerSlug: provider, authMethod: 'api-key' },
    credentialAuth: { authMethod: 'api-key' },
    entry: {
      id,
      provider,
      tags,
      supportsTools: true,
      supportsVision: false,
      contextWindow: 100_000,
    },
  };
}

const WORLD = [
  hit('openai', 'gpt-5', 'https://api.openai.com/v1'),
  hit('openai', 'tts-1', 'https://api.openai.com/v1', ['text-to-speech']),
  hit('acme', 'acme-large', 'https://llm.acme.eu/v1'),
];

function underPolicy(policy: ModelEndpointPolicy): void {
  vi.mocked(readModelEndpointPolicyForOrg).mockResolvedValue(policy);
}

function listed(models: ReadonlyArray<{ providerSlug: string; id: string }>) {
  return models.map((model) => `${model.providerSlug}/${model.id}`);
}

beforeEach(() => {
  vi.mocked(walkChatCatalog).mockReset().mockResolvedValue(WORLD);
  vi.mocked(listServingCredentialFacts).mockReset().mockResolvedValue([]);
  vi.mocked(getAccessibleModelsForUser)
    .mockReset()
    .mockImplementation(async (_sql, args) => args.modelIds);
  vi.mocked(getAccessibleModelsForMembers)
    .mockReset()
    .mockImplementation(async (_sql, args) => args.modelIds);
  vi.mocked(inspectTranscriptionModels)
    .mockReset()
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the listing reads only the pick and the error
    .mockResolvedValue({ pick: null } as unknown as Awaited<
      ReturnType<typeof inspectTranscriptionModels>
    >);
  vi.mocked(readModelEndpointPolicyForOrg).mockReset();
});

describe('listComposerModels — the EU/EEA processing rule [GOV-R22]', () => {
  it('lists every servable model, and says nothing, while the rule is off', async () => {
    underPolicy({ kind: 'open' });
    const listing = await listComposerModels(SQL, ARGS);
    expect(listed(listing.models)).toEqual(['acme/acme-large', 'openai/gpt-5']);
    expect(listing.modelsHiddenBy).toBeUndefined();
    expect(listing.voice.ttsAvailable).toBe(true);
  });

  it('leaves out the models whose endpoint the rule refuses, and their voice, and says why', async () => {
    underPolicy({ kind: 'eu', attestedHosts: ['llm.acme.eu'] });
    const listing = await listComposerModels(SQL, ARGS);
    expect(listed(listing.models)).toEqual(['acme/acme-large']);
    expect(listing.modelsHiddenBy).toBe('eu');
    expect(listing.voice.ttsAvailable).toBe(false);
    // Access is judged over what the rule let through.
    expect(getAccessibleModelsForUser).toHaveBeenCalledWith(SQL, {
      ...ARGS,
      modelIds: ['acme-large'],
    });
  });

  it('lists nothing while the policy cannot be read, and says so', async () => {
    underPolicy({ kind: 'unreadable' });
    const listing = await listComposerModels(SQL, ARGS);
    expect(listing.models).toEqual([]);
    expect(listing.modelsHiddenBy).toBe('unreadable');
  });

  it('offers a choice made for the organization only what the rule lets through', async () => {
    underPolicy({ kind: 'eu', attestedHosts: ['llm.acme.eu'] });
    expect(listed(await listOrganizationChatModels(SQL, 'org-1'))).toEqual([
      'acme/acme-large',
    ]);
  });

  it('keeps every model for a caller that judges another endpoint, without reading the rule', async () => {
    const models = await listGovernedChatModels(SQL, {
      ...ARGS,
      withRefusedEndpoints: true,
    });
    expect(listed(models)).toEqual(['acme/acme-large', 'openai/gpt-5']);
    expect(readModelEndpointPolicyForOrg).not.toHaveBeenCalled();
  });
});
