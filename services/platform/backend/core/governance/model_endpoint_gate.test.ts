import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCtxShim } from '../../lib/ctx-shim.ts';
import type { ActionCtx } from '../lib/ctx.ts';
import {
  assertModelEndpointAllowed,
  gatewayBuiltinRefusal,
  gatewayModelRefusal,
  isModelEndpointRefusalCode,
  ModelEndpointRefusal,
  type ModelEndpointCall,
  type ModelEndpointPolicy,
  modelEndpointPolicyOf,
  modelEndpointRefusal,
  moderationEndpointRefusal,
  readModelEndpointPolicy,
  withoutRefusedModels,
} from './model_endpoint_gate.ts';

const EU: ModelEndpointPolicy = {
  kind: 'eu',
  attestedHosts: ['llm.example.eu'],
};

function call(baseUrl: string | undefined): ModelEndpointCall {
  return {
    organizationId: 'org_1',
    surface: 'chat',
    providerName: 'openrouter',
    modelId: 'openai/gpt-5',
    baseUrl,
    actor: { id: 'user_1', type: 'user' },
  };
}

/** A ctx whose governance seam answers `policy`, recording every write —
 * dispatched by name, as every shim host dispatches it. */
function gateCtx(
  policy: unknown,
  write: (args: unknown) => Promise<unknown> = async () => null,
) {
  const runQuery = vi.fn(async (_args: unknown) => policy);
  const runMutation = vi.fn(write);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the gate reaches only these two seams
  const ctx = createCtxShim({
    'governance/internal_queries:getModelEndpointPolicyInternal': runQuery,
    'governance/internal_mutations:recordModelEndpointRefusal': runMutation,
  }) as unknown as ActionCtx;
  return { ctx, runQuery, runMutation };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('modelEndpointPolicyOf', () => {
  it('is open without a policy or with the switch off [GOV-R17]', () => {
    expect(modelEndpointPolicyOf(null)).toEqual({ kind: 'open' });
    expect(
      modelEndpointPolicyOf({
        enabled: true,
        mode: 'allowlist',
        rules: [],
        euProcessing: { enabled: false, hosts: ['llm.example.eu'] },
      }),
    ).toEqual({ kind: 'open' });
  });

  it('carries the attested hosts when the switch is on, whatever the rules say [GOV-R17]', () => {
    expect(
      modelEndpointPolicyOf({
        enabled: false,
        mode: 'blocklist',
        rules: [],
        euProcessing: {
          enabled: true,
          hosts: ['b.example.eu', 'a.example.eu'],
        },
      }),
    ).toEqual({ kind: 'eu', attestedHosts: ['a.example.eu', 'b.example.eu'] });
  });
});

describe('modelEndpointRefusal', () => {
  it('lets every call through while the rule is off [GOV-R17]', () => {
    expect(
      modelEndpointRefusal(
        { kind: 'open' },
        call('https://openrouter.ai/api/v1'),
      ),
    ).toBeUndefined();
    expect(
      modelEndpointRefusal({ kind: 'open' }, call(undefined)),
    ).toBeUndefined();
  });

  it.each([
    'https://eu.openrouter.ai/api/v1',
    'https://eu.api.openai.com/v1',
    'https://api.eu.mistral.ai/v1',
    'https://llm.example.eu/v1',
  ])('lets %s through under the rule [GOV-R17]', (url) => {
    expect(modelEndpointRefusal(EU, call(url))).toBeUndefined();
  });

  it('refuses the global OpenRouter host and names its EU endpoint [GOV-R17]', () => {
    const refusal = modelEndpointRefusal(
      EU,
      call('https://openrouter.ai/api/v1'),
    );
    expect(refusal).toMatchObject({
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      provider: 'openrouter',
      host: 'openrouter.ai',
      reason: 'vendor-global',
    });
    expect(refusal?.message).toContain('only in the EU/EEA');
    expect(refusal?.message).toContain('eu.openrouter.ai');
    expect(refusal?.message).toContain('was not sent');
  });

  it('refuses a vendor US endpoint and names the EU one [GOV-R17]', () => {
    const refusal = modelEndpointRefusal(
      EU,
      call('https://us.api.openai.com/v1'),
    );
    expect(refusal).toMatchObject({
      host: 'us.api.openai.com',
      reason: 'regional-outside-eu',
    });
    expect(refusal?.message).toContain('eu.api.openai.com');
  });

  it('refuses a host no admin attested and says where to attest it [GOV-R17]', () => {
    const refusal = modelEndpointRefusal(EU, call('https://api.anthropic.com'));
    expect(refusal).toMatchObject({
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      host: 'api.anthropic.com',
      reason: 'not-attested',
    });
    expect(refusal?.message).toContain(
      'Settings → Governance → Models → Model access',
    );
  });

  it('refuses a provider that names no endpoint [GOV-R17]', () => {
    const refusal = modelEndpointRefusal(EU, call(undefined));
    expect(refusal).toMatchObject({
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      reason: 'unknown-endpoint',
    });
    expect(refusal).not.toHaveProperty('host');
    expect(refusal?.message).toContain('names no endpoint');
  });

  it('refuses every call while the policy cannot be read [GOV-R17]', () => {
    const refusal = modelEndpointRefusal(
      { kind: 'unreadable' },
      call('https://eu.openrouter.ai/api/v1'),
    );
    expect(refusal).toMatchObject({
      code: 'MODEL_ENDPOINT_POLICY_UNREADABLE',
      provider: 'openrouter',
    });
    expect(refusal?.message).toContain('cannot be read');
  });
});

describe('moderationEndpointRefusal', () => {
  it('lets every moderation endpoint through while the rule is off [GOV-R23]', () => {
    expect(
      moderationEndpointRefusal(
        { kind: 'open' },
        'https://api.openai.com/v1/moderations',
      ),
    ).toBeUndefined();
  });

  it.each([
    'https://eu.api.openai.com/v1/moderations',
    'https://llm.example.eu/moderate',
  ])('lets %s through under the rule [GOV-R23]', (url) => {
    expect(moderationEndpointRefusal(EU, url)).toBeUndefined();
  });

  it('refuses a vendor’s global endpoint and names its EU one, in the moderation step’s words [GOV-R23]', () => {
    expect(
      moderationEndpointRefusal(EU, 'https://api.openai.com/v1/moderations'),
    ).toEqual({
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      message:
        'This organization processes prompts only in the EU/EEA, and api.openai.com may process prompts outside it, so the text was not sent to the moderation provider. An admin can point the moderation provider at eu.api.openai.com instead.',
      provider: 'moderation_provider',
      host: 'api.openai.com',
      reason: 'vendor-global',
    });
  });

  it('refuses a host no admin attested and says where to attest it [GOV-R23]', () => {
    const refusal = moderationEndpointRefusal(
      EU,
      'https://moderation.example.com/v1',
    );
    expect(refusal).toMatchObject({
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      provider: 'moderation_provider',
      host: 'moderation.example.com',
      reason: 'not-attested',
    });
    expect(refusal?.message).toBe(
      'This organization processes prompts only in the EU/EEA, and moderation.example.com is not an endpoint known to process there, so the text was not sent to the moderation provider. If it does process in the EU/EEA, an admin can list it under Settings → Governance → Models → Model access.',
    );
  });

  it('refuses an endpoint that names no host [GOV-R23]', () => {
    const refusal = moderationEndpointRefusal(EU, 'not a url');
    expect(refusal).toMatchObject({ reason: 'unknown-endpoint' });
    expect(refusal).not.toHaveProperty('host');
    expect(refusal?.message).toContain(
      'the moderation provider names no endpoint known to process there',
    );
  });

  it('refuses every endpoint while the policy cannot be read [GOV-R23]', () => {
    expect(
      moderationEndpointRefusal(
        { kind: 'unreadable' },
        'https://eu.api.openai.com/v1/moderations',
      ),
    ).toEqual({
      code: 'MODEL_ENDPOINT_POLICY_UNREADABLE',
      message: expect.stringContaining(
        'the text was not sent to the moderation provider',
      ),
      provider: 'moderation_provider',
    });
  });
});

describe('gatewayBuiltinRefusal', () => {
  it('lets the gateway’s built-in connection through while the rule is off [GOV-R17]', () => {
    expect(gatewayBuiltinRefusal({ kind: 'open' }, 'openrouter')).toBe(
      undefined,
    );
  });

  it('refuses it under the rule, whatever the admin attested, and says what to do [GOV-R17]', () => {
    const refusal = gatewayBuiltinRefusal(
      { kind: 'eu', attestedHosts: ['openrouter.ai', 'api.groq.com'] },
      'groq',
    );
    expect(refusal).toEqual({
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      message: expect.stringContaining('through its built-in connection'),
      provider: 'groq',
      reason: 'gateway-builtin',
    });
    expect(refusal?.message).toContain(
      'An admin can serve the model through a custom provider whose endpoint processes in the EU/EEA.',
    );
  });

  it('refuses it while the policy cannot be read [GOV-R17]', () => {
    expect(
      gatewayBuiltinRefusal({ kind: 'unreadable' }, 'openrouter'),
    ).toMatchObject({
      code: 'MODEL_ENDPOINT_POLICY_UNREADABLE',
      provider: 'openrouter',
    });
  });
});

describe('withoutRefusedModels', () => {
  const candidates = [
    { id: 'eu-model', baseUrl: 'https://llm.example.eu/v1' },
    { id: 'us-model', baseUrl: 'https://api.openai.com/v1' },
  ];
  const refusalOf =
    (policy: ModelEndpointPolicy) => (candidate: (typeof candidates)[number]) =>
      modelEndpointRefusal(policy, {
        providerName: 'acme',
        baseUrl: candidate.baseUrl,
      });

  it('offers every model, and says nothing, while the rule is off [GOV-R22]', () => {
    const open: ModelEndpointPolicy = { kind: 'open' };
    expect(withoutRefusedModels(open, candidates, refusalOf(open))).toEqual({
      kept: candidates,
    });
  });

  it('leaves out the models whose endpoint the rule refuses, and says so [GOV-R22]', () => {
    expect(withoutRefusedModels(EU, candidates, refusalOf(EU))).toEqual({
      kept: [candidates[0]],
      hiddenBy: 'eu',
    });
  });

  it('says nothing when the rule let every model through [GOV-R22]', () => {
    expect(
      withoutRefusedModels(EU, candidates.slice(0, 1), refusalOf(EU)),
    ).toEqual({ kept: [candidates[0]] });
  });

  it('offers no model while the policy cannot be read [GOV-R22]', () => {
    const unreadable: ModelEndpointPolicy = { kind: 'unreadable' };
    expect(
      withoutRefusedModels(unreadable, candidates, refusalOf(unreadable)),
    ).toEqual({ kept: [], hiddenBy: 'unreadable' });
  });
});

describe('gatewayModelRefusal', () => {
  it('lets every record through while the rule is off [GOV-R17]', () => {
    expect(
      gatewayModelRefusal(
        { kind: 'open' },
        { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
        true,
      ),
    ).toBe(undefined);
  });

  it('judges a standard provider by the built-in connection, whatever base URL it names [GOV-R17]', () => {
    expect(
      gatewayModelRefusal(EU, {
        name: 'openrouter',
        baseUrl: 'https://eu.openrouter.ai/api/v1',
      }),
    ).toMatchObject({ provider: 'openrouter', reason: 'gateway-builtin' });
  });

  it('judges a custom record by its own base URL, so OpenRouter passes only at eu.openrouter.ai [GOV-R17]', () => {
    expect(
      gatewayModelRefusal(EU, {
        name: 'openrouter-eu',
        baseUrl: 'https://eu.openrouter.ai/api/v1',
      }),
    ).toBe(undefined);
    expect(
      gatewayModelRefusal(EU, {
        name: 'openrouter-eu',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    ).toMatchObject({ host: 'openrouter.ai', reason: 'vendor-global' });
    expect(
      gatewayModelRefusal(EU, {
        name: 'own-proxy',
        baseUrl: 'https://llm.example.eu/v1',
      }),
    ).toBe(undefined);
    expect(
      gatewayModelRefusal(EU, {
        name: 'own-proxy',
        baseUrl: 'https://llm.example.com/v1',
      }),
    ).toMatchObject({ host: 'llm.example.com', reason: 'not-attested' });
  });

  it('judges the Anthropic harness lane by the native endpoint, else the base URL, standard name or not [GOV-R17]', () => {
    const declared = {
      name: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      harnessEndpoint: {
        baseUrl: 'https://eu.openrouter.ai/api',
        apiFormat: 'anthropic' as const,
      },
    };
    expect(gatewayModelRefusal(EU, declared, true)).toBe(undefined);
    expect(gatewayModelRefusal(EU, declared)).toMatchObject({
      reason: 'gateway-builtin',
    });
    expect(
      gatewayModelRefusal(
        EU,
        { name: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' },
        true,
      ),
    ).toMatchObject({ host: 'openrouter.ai', reason: 'vendor-global' });
  });

  it('refuses every record while the policy cannot be read [GOV-R17]', () => {
    expect(
      gatewayModelRefusal(
        { kind: 'unreadable' },
        { name: 'own-proxy', baseUrl: 'https://llm.example.eu/v1' },
      ),
    ).toMatchObject({
      code: 'MODEL_ENDPOINT_POLICY_UNREADABLE',
      provider: 'own-proxy',
    });
  });
});

describe('isModelEndpointRefusalCode', () => {
  it('knows both refusal codes and nothing else', () => {
    expect(isModelEndpointRefusalCode('MODEL_ENDPOINT_OUTSIDE_EU')).toBe(true);
    expect(isModelEndpointRefusalCode('MODEL_ENDPOINT_POLICY_UNREADABLE')).toBe(
      true,
    );
    expect(isModelEndpointRefusalCode('CHAT_MODEL_UNKNOWN')).toBe(false);
    expect(isModelEndpointRefusalCode(undefined)).toBe(false);
  });
});

describe('readModelEndpointPolicy', () => {
  it('asks the governance seam for the organization [GOV-R17]', async () => {
    const { ctx, runQuery } = gateCtx(EU);
    await expect(readModelEndpointPolicy(ctx, 'org_1')).resolves.toEqual(EU);
    expect(runQuery).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org_1',
    });
  });

  it.each([null, undefined, { kind: 'eu' }, { kind: 'closed' }, 'open'])(
    'reads an answer it does not recognize as unreadable: %j [GOV-R17]',
    async (answer) => {
      const { ctx } = gateCtx(answer);
      await expect(readModelEndpointPolicy(ctx, 'org_1')).resolves.toEqual({
        kind: 'unreadable',
      });
    },
  );
});

describe('assertModelEndpointAllowed', () => {
  it('passes a compliant call without a write [GOV-R17]', async () => {
    const { ctx, runMutation } = gateCtx(EU);
    await expect(
      assertModelEndpointAllowed(ctx, call('https://eu.openrouter.ai/api/v1')),
    ).resolves.toBeUndefined();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('passes every call while the rule is off [GOV-R17]', async () => {
    const { ctx, runMutation } = gateCtx({ kind: 'open' });
    await expect(
      assertModelEndpointAllowed(ctx, call('https://openrouter.ai/api/v1')),
    ).resolves.toBeUndefined();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('audits a refused call, then throws its reason [GOV-R17]', async () => {
    const { ctx, runMutation } = gateCtx(EU);
    const refused = assertModelEndpointAllowed(
      ctx,
      call('https://openrouter.ai/api/v1'),
    );
    await expect(refused).rejects.toBeInstanceOf(ModelEndpointRefusal);
    await expect(refused).rejects.toMatchObject({
      data: { code: 'MODEL_ENDPOINT_OUTSIDE_EU', host: 'openrouter.ai' },
    });
    expect(runMutation).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org_1',
      surface: 'chat',
      provider: 'openrouter',
      model: 'openai/gpt-5',
      host: 'openrouter.ai',
      reason: 'vendor-global',
      code: 'MODEL_ENDPOINT_OUTSIDE_EU',
      message: expect.stringContaining('eu.openrouter.ai'),
      actor: { id: 'user_1', type: 'user' },
    });
  });

  it('uses the policy a caller already read [GOV-R17]', async () => {
    const { ctx, runQuery } = gateCtx({ kind: 'open' });
    await expect(
      assertModelEndpointAllowed(ctx, call('https://api.anthropic.com'), EU),
    ).rejects.toMatchObject({ data: { reason: 'not-attested' } });
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('still refuses when the audit entry cannot be written [GOV-R17]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { ctx } = gateCtx({ kind: 'unreadable' }, async () => {
      throw new Error('database down');
    });
    await expect(
      assertModelEndpointAllowed(ctx, call('https://eu.openrouter.ai/api/v1')),
    ).rejects.toMatchObject({
      data: { code: 'MODEL_ENDPOINT_POLICY_UNREADABLE' },
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});
