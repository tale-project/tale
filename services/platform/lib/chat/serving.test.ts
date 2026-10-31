import { describe, expect, it } from 'vitest';

import {
  SERVING_LABEL_MAX_CHARS,
  SERVING_VALUES_MAX,
  createServingTally,
  euProcessingVerdict,
  isAttestableEndpointHost,
  mergeServedBy,
  regionalEndpoint,
  sameServedBy,
  servedBy,
  servingLabel,
  vendorEuEndpoint,
} from './serving';

describe('servingLabel', () => {
  it('keeps a provider name as written, trimmed', () => {
    expect(servingLabel('  Google Vertex ')).toBe('Google Vertex');
  });

  it('drops what is not a usable string', () => {
    expect(servingLabel(undefined)).toBeUndefined();
    expect(servingLabel(null)).toBeUndefined();
    expect(servingLabel(42)).toBeUndefined();
    expect(servingLabel({ name: 'Anthropic' })).toBeUndefined();
    expect(servingLabel('   ')).toBeUndefined();
  });

  it('turns control characters into spaces so a label stays one line', () => {
    expect(servingLabel('Sweden\nCentral\u0000')).toBe('Sweden Central');
  });

  it('bounds an overlong value', () => {
    const label = servingLabel('x'.repeat(500));
    expect(label).toHaveLength(SERVING_LABEL_MAX_CHARS);
  });
});

describe('servedBy', () => {
  it('keeps only the fields that carry a usable value', () => {
    expect(
      servedBy({ provider: 'Anthropic', region: '', model: undefined }),
    ).toEqual({ provider: 'Anthropic' });
  });

  it('is undefined when nothing is named', () => {
    expect(servedBy({ provider: null, region: 7 })).toBeUndefined();
  });
});

describe('mergeServedBy / sameServedBy', () => {
  it('lets a later statement win field by field', () => {
    expect(
      mergeServedBy(
        { region: 'Sweden Central', model: 'gpt-4o' },
        { model: 'gpt-4o-2024-11-20' },
      ),
    ).toEqual({ region: 'Sweden Central', model: 'gpt-4o-2024-11-20' });
    expect(mergeServedBy(undefined, { provider: 'Groq' })).toEqual({
      provider: 'Groq',
    });
    expect(mergeServedBy({ provider: 'Groq' }, undefined)).toEqual({
      provider: 'Groq',
    });
  });

  it('compares what two statements say', () => {
    expect(sameServedBy({ provider: 'A' }, { provider: 'A' })).toBe(true);
    expect(sameServedBy(undefined, undefined)).toBe(true);
    expect(sameServedBy({ provider: 'A' }, { provider: 'B' })).toBe(false);
    expect(sameServedBy(undefined, { model: 'm' })).toBe(false);
    expect(
      sameServedBy(
        { endpoint: { host: 'eu.openrouter.ai', region: 'europe' } },
        { endpoint: { host: 'us.openrouter.ai', region: 'united-states' } },
      ),
    ).toBe(false);
  });
});

describe('regionalEndpoint', () => {
  it.each([
    ['https://eu.openrouter.ai/api/v1', 'eu.openrouter.ai', 'europe'],
    ['https://us.openrouter.ai/api/v1', 'us.openrouter.ai', 'united-states'],
    ['https://eu.api.openai.com/v1', 'eu.api.openai.com', 'europe'],
    ['https://api.eu.mistral.ai/v1', 'api.eu.mistral.ai', 'europe'],
    [
      'https://EU.OpenRouter.ai/api/v1/chat/completions',
      'eu.openrouter.ai',
      'europe',
    ],
  ])('names the region %s is processed in', (url, host, region) => {
    expect(regionalEndpoint(url)).toEqual({ host, region });
  });

  it.each([
    'https://openrouter.ai/api/v1',
    'https://api.openai.com/v1',
    'https://api.anthropic.com',
    'https://my-resource.openai.azure.com/openai/v1',
    'http://127.0.0.1:4141/v1',
    'not a url',
  ])('names no region for %s', (url) => {
    expect(regionalEndpoint(url)).toBeUndefined();
  });
});

describe('euProcessingVerdict', () => {
  const attested = ['llm.example.eu', 'contoso-se.openai.azure.com'];

  it.each([
    'https://eu.openrouter.ai/api/v1',
    'https://eu.api.openai.com/v1',
    'https://api.eu.mistral.ai/v1',
    'https://EU.OpenRouter.ai/api/v1',
  ])('lets a vendor EU endpoint through: %s [GOV-R17]', (url) => {
    expect(euProcessingVerdict(url, [])).toMatchObject({ allowed: true });
  });

  it.each([
    ['https://llm.example.eu:8443/v1', 'llm.example.eu'],
    [
      'https://contoso-se.openai.azure.com/openai/v1',
      'contoso-se.openai.azure.com',
    ],
  ])('lets an attested host through: %s [GOV-R17]', (url, host) => {
    expect(euProcessingVerdict(url, attested)).toEqual({
      allowed: true,
      host,
    });
  });

  it.each([
    ['https://openrouter.ai/api/v1', 'openrouter.ai', 'vendor-global'],
    ['https://api.openai.com/v1', 'api.openai.com', 'vendor-global'],
    ['https://api.mistral.ai/v1', 'api.mistral.ai', 'vendor-global'],
    [
      'https://us.openrouter.ai/api/v1',
      'us.openrouter.ai',
      'regional-outside-eu',
    ],
    [
      'https://us.api.openai.com/v1',
      'us.api.openai.com',
      'regional-outside-eu',
    ],
    ['https://api.anthropic.com', 'api.anthropic.com', 'not-attested'],
    [
      'https://other-us.openai.azure.com/openai/v1',
      'other-us.openai.azure.com',
      'not-attested',
    ],
  ])('refuses %s [GOV-R17]', (url, host, reason) => {
    expect(euProcessingVerdict(url, attested)).toEqual({
      allowed: false,
      host,
      reason,
    });
  });

  it('counts a vendor host only as its EU endpoint, attested or not [GOV-R17]', () => {
    expect(
      euProcessingVerdict('https://openrouter.ai/api/v1', ['openrouter.ai']),
    ).toMatchObject({ allowed: false, reason: 'vendor-global' });
    expect(isAttestableEndpointHost('openrouter.ai')).toBe(false);
    expect(isAttestableEndpointHost('us.api.openai.com')).toBe(false);
    expect(isAttestableEndpointHost('proxy.mistral.ai')).toBe(false);
    expect(isAttestableEndpointHost('llm.example.eu')).toBe(true);
    expect(isAttestableEndpointHost('[fd00::1]')).toBe(true);
  });

  it.each([
    ['openrouter.ai', 'eu.openrouter.ai'],
    ['us.openrouter.ai', 'eu.openrouter.ai'],
    ['api.openai.com', 'eu.api.openai.com'],
    ['US.API.OpenAI.com', 'eu.api.openai.com'],
    ['api.mistral.ai', 'api.eu.mistral.ai'],
    ['api.anthropic.com', undefined],
    ['llm.example.eu', undefined],
  ])('names the EU endpoint of the vendor of %s [GOV-R17]', (host, eu) => {
    expect(vendorEuEndpoint(host)).toBe(eu);
  });

  it.each([undefined, '', 'not a url', 'file:///etc/hosts'])(
    'refuses an endpoint that names no host: %j [GOV-R17]',
    (url) => {
      expect(euProcessingVerdict(url, attested)).toEqual({
        allowed: false,
        host: undefined,
        reason: 'unknown-endpoint',
      });
    },
  );
});

describe('createServingTally', () => {
  it('keeps the distinct values of every round, in first-served order', () => {
    const tally = createServingTally('anthropic/claude-sonnet-4.6');
    tally.add({
      provider: 'Google Vertex',
      model: 'anthropic/claude-sonnet-4.6',
    });
    tally.add({ provider: 'Anthropic' });
    tally.add({ provider: 'google vertex' });
    tally.add(undefined);
    expect(tally.stamp()).toEqual({
      providers: ['Google Vertex', 'Anthropic'],
    });
  });

  it('keeps a model id only when it differs from the requested one', () => {
    const tally = createServingTally('gpt-4o-ch');
    tally.add({ model: 'GPT-4O-CH' });
    expect(tally.stamp()).toBeUndefined();
    tally.add({ model: 'gpt-4o-2024-11-20', region: 'Switzerland North' });
    expect(tally.stamp()).toEqual({
      regions: ['Switzerland North'],
      models: ['gpt-4o-2024-11-20'],
    });
  });

  it('keeps the regional endpoint the turn was sent to', () => {
    const tally = createServingTally('openai/gpt-5');
    tally.add({ endpoint: { host: 'eu.openrouter.ai', region: 'europe' } });
    tally.add({ provider: 'Azure' });
    expect(tally.stamp()).toEqual({
      providers: ['Azure'],
      endpoint: { host: 'eu.openrouter.ai', region: 'europe' },
    });
  });

  it('caps each list, so a long tool loop cannot grow the stamp', () => {
    const tally = createServingTally('m');
    for (let index = 0; index < 20; index += 1) {
      tally.add({ provider: `Upstream ${index}` });
    }
    expect(tally.stamp()?.providers).toHaveLength(SERVING_VALUES_MAX);
  });
});
