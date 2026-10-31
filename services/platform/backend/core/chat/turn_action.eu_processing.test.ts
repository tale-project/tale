// @vitest-environment node

/**
 * A chat reply and a task's native turn resolve their wire in one place
 * (`resolveDirectWire`), ahead of the history read and of any row: with the
 * organization's EU/EEA rule on, the endpoint the request would go to — the
 * credential's own, else the provider's — is judged there, and a refused one
 * throws before anything is sent (GOV-R17).
 */

import { providerDefinitionSchema } from '@tale/shared/schemas/providers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../provider_credentials/resolve_credential', () => ({
  resolveProviderCredential: vi.fn(),
}));

import { classifyChatErrorCode } from '../../../lib/shared/chat-errors';
import { createCtxShim } from '../../lib/ctx-shim';
import type { ModelEndpointPolicy } from '../governance/model_endpoint_gate';
import type { ActionCtx } from '../lib/ctx';
import { resolveProviderCredential } from '../provider_credentials/resolve_credential';
import { resolveDirectWire } from './turn_action';

const openrouter = providerDefinitionSchema.parse({
  name: 'openrouter',
  displayName: 'OpenRouter',
  apiFormat: 'openai',
  baseUrl: 'https://openrouter.ai/api/v1',
  catalog: { source: 'models-endpoint' },
  embedding: 'unknown',
  auth: [{ method: 'api-key' }],
});

const custom = providerDefinitionSchema.parse({
  name: 'house-llm',
  displayName: 'House LLM',
  apiFormat: 'openai',
  baseUrl: 'https://llm.example.eu/v1',
  catalog: { source: 'models-endpoint' },
  embedding: 'unknown',
  auth: [{ method: 'api-key' }],
});

const EU: ModelEndpointPolicy = {
  kind: 'eu',
  attestedHosts: ['llm.example.eu'],
};

const CHAT = { organizationId: 'org_1', userId: 'user_1' };

function credential(endpointUrl?: string) {
  vi.mocked(resolveProviderCredential).mockResolvedValue({
    authMethod: 'api-key',
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an id the wire never reads
    credentialId: 'cred_1' as never,
    name: 'default',
    secret: 'sk-synthetic',
    ...(endpointUrl !== undefined ? { endpointUrl } : {}),
  });
}

function gateCtx(policy: ModelEndpointPolicy) {
  const audit = vi.fn(async (_args: unknown) => null);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the wire reaches only the credential (mocked) and the governance seams
  const ctx = createCtxShim({
    'governance/internal_queries:getModelEndpointPolicyInternal': async () =>
      policy,
    'governance/internal_mutations:recordModelEndpointRefusal': audit,
  }) as unknown as ActionCtx;
  return { ctx, audit };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  credential();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(resolveProviderCredential).mockReset();
});

describe('resolveDirectWire — the EU/EEA rule [GOV-R17]', () => {
  it('refuses a chat call to a global endpoint before anything is sent', async () => {
    const { ctx, audit } = gateCtx(EU);
    const refused = resolveDirectWire(ctx, CHAT, openrouter, 'openai/gpt-5');
    await expect(refused).rejects.toMatchObject({
      data: {
        code: 'MODEL_ENDPOINT_OUTSIDE_EU',
        host: 'openrouter.ai',
        reason: 'vendor-global',
        message: expect.stringContaining('eu.openrouter.ai'),
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        organizationId: 'org_1',
        surface: 'chat',
        provider: 'openrouter',
        model: 'openai/gpt-5',
        host: 'openrouter.ai',
        actor: { id: 'user_1', type: 'user' },
      }),
    );
  });

  it('lets OpenRouter through on its EU endpoint, set on the credential', async () => {
    credential('https://eu.openrouter.ai/api/v1');
    const { ctx, audit } = gateCtx(EU);
    await expect(
      resolveDirectWire(ctx, CHAT, openrouter, 'openai/gpt-5'),
    ).resolves.toMatchObject({ baseUrl: 'https://eu.openrouter.ai/api/v1' });
    expect(audit).not.toHaveBeenCalled();
  });

  it('judges the credential’s endpoint, not the provider’s, when it has one', async () => {
    credential('https://us.api.openai.com/v1');
    const { ctx } = gateCtx(EU);
    await expect(
      resolveDirectWire(ctx, CHAT, custom, 'house-model'),
    ).rejects.toMatchObject({
      data: { host: 'us.api.openai.com', reason: 'regional-outside-eu' },
    });
  });

  it('lets a custom provider an admin marked as processing in the EU/EEA through', async () => {
    const { ctx } = gateCtx(EU);
    await expect(
      resolveDirectWire(ctx, CHAT, custom, 'house-model'),
    ).resolves.toMatchObject({ baseUrl: 'https://llm.example.eu/v1' });
  });

  it('names a task turn and the key that started it in the audit entry', async () => {
    const { ctx, audit } = gateCtx(EU);
    await expect(
      resolveDirectWire(
        ctx,
        { ...CHAT, apiKeyId: 'key_1', surface: 'task' },
        openrouter,
        'openai/gpt-5',
      ),
    ).rejects.toMatchObject({ data: { code: 'MODEL_ENDPOINT_OUTSIDE_EU' } });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'task',
        actor: { id: 'user_1', type: 'api' },
      }),
    );
  });

  it('refuses every call while the policy cannot be read', async () => {
    credential('https://eu.openrouter.ai/api/v1');
    const { ctx } = gateCtx({ kind: 'unreadable' });
    await expect(
      resolveDirectWire(ctx, CHAT, openrouter, 'openai/gpt-5'),
    ).rejects.toMatchObject({
      data: { code: 'MODEL_ENDPOINT_POLICY_UNREADABLE' },
    });
  });

  it('changes nothing while the switch is off', async () => {
    const { ctx, audit } = gateCtx({ kind: 'open' });
    await expect(
      resolveDirectWire(ctx, CHAT, openrouter, 'openai/gpt-5'),
    ).resolves.toMatchObject({ baseUrl: 'https://openrouter.ai/api/v1' });
    expect(audit).not.toHaveBeenCalled();
  });

  it('reads as an unavailable model to a chat and to a task run', async () => {
    const { ctx } = gateCtx(EU);
    const error: unknown = await resolveDirectWire(
      ctx,
      CHAT,
      openrouter,
      'openai/gpt-5',
    ).catch((thrown: unknown) => thrown);
    expect(classifyChatErrorCode(error)).toBe('model_not_found');
  });
});
