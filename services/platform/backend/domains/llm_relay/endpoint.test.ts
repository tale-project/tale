import { describe, expect, it } from 'vitest';

import {
  type RelayConnector,
  UpstreamUnavailableError,
  upstreamFor,
  upstreamHeaders,
  upstreamUrl,
} from './endpoint.ts';
import type { RelayModel } from './models.ts';

const model = (over: Partial<RelayModel> = {}): RelayModel => ({
  providerSlug: 'deepseek',
  modelId: 'deepseek-v4',
  anthropicLane: false,
  ref: 'org_1__deepseek__deepseek-v4/deepseek-v4',
  ...over,
});

const deepseek: RelayConnector = {
  name: 'deepseek',
  apiFormat: 'openai',
  baseUrl: 'https://api.deepseek.com/',
  apiKey: 'sk-upstream',
  harnessEndpoint: {
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiFormat: 'anthropic',
  },
};

describe('where a call goes upstream', () => {
  it('takes the connector’s own endpoint and wire', () => {
    const endpoint = upstreamFor(deepseek, model(), 'openai-chat', undefined);
    expect(endpoint).toMatchObject({
      wire: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-v4',
    });
    expect(upstreamUrl(endpoint)).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(upstreamHeaders(endpoint)).toMatchObject({
      authorization: 'Bearer sk-upstream',
      'content-type': 'application/json',
    });
  });

  it('takes the harness endpoint on the Anthropic lane, with the version the client sent', () => {
    const endpoint = upstreamFor(
      deepseek,
      model({ anthropicLane: true }),
      'anthropic',
      undefined,
    );
    expect(endpoint.wire).toBe('anthropic');
    expect(upstreamUrl(endpoint)).toBe(
      'https://api.deepseek.com/anthropic/v1/messages',
    );
    expect(upstreamUrl(endpoint, 'count-tokens')).toBe(
      'https://api.deepseek.com/anthropic/v1/messages/count_tokens',
    );
    expect(
      upstreamHeaders(endpoint, {
        anthropicVersion: '2023-06-01',
        anthropicBeta: 'interleaved-thinking-2025-05-14',
      }),
    ).toMatchObject({
      'x-api-key': 'sk-upstream',
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14',
    });
  });

  it('keeps a Responses request on the Responses API only where the upstream serves it', () => {
    const openai: RelayConnector = {
      name: 'openai',
      apiFormat: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-openai',
    };
    expect(
      upstreamFor(
        openai,
        model({ providerSlug: 'openai' }),
        'openai-responses',
        undefined,
      ).wire,
    ).toBe('openai-responses');
    expect(
      upstreamFor(deepseek, model(), 'openai-responses', {
        toolCallingApi: 'responses',
      }).wire,
    ).toBe('openai-responses');
    expect(
      upstreamFor(deepseek, model(), 'openai-responses', undefined).wire,
    ).toBe('openai-chat');
    expect(upstreamFor(openai, model(), 'openai-chat', undefined).wire).toBe(
      'openai-chat',
    );
  });

  it('refuses a lane the connector has no endpoint for, and a connector with no endpoint', () => {
    expect(() =>
      upstreamFor(
        { ...deepseek, harnessEndpoint: undefined },
        model({ anthropicLane: true }),
        'anthropic',
        undefined,
      ),
    ).toThrow(UpstreamUnavailableError);
    expect(() =>
      upstreamFor(
        { ...deepseek, baseUrl: undefined },
        model(),
        'openai-chat',
        undefined,
      ),
    ).toThrow(/no API endpoint/);
  });

  it('holds the endpoint to the provider host policy', () => {
    expect(() =>
      upstreamFor(
        { ...deepseek, baseUrl: 'http://169.254.169.254/v1' },
        model(),
        'openai-chat',
        undefined,
      ),
    ).toThrow(/blocked/);
  });

  it('attributes a call to OpenRouter as the gateway did', () => {
    const endpoint = upstreamFor(
      {
        name: 'openrouter',
        apiFormat: 'openai',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: 'sk-or',
      },
      model({ providerSlug: 'openrouter' }),
      'openai-chat',
      undefined,
    );
    expect(Object.keys(upstreamHeaders(endpoint))).toEqual(
      expect.arrayContaining(['HTTP-Referer', 'X-Title']),
    );
  });
});

describe('the effort a call with tools must carry', () => {
  const openai: RelayConnector = {
    name: 'openai',
    apiFormat: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-openai',
  };
  /** A model whose Chat Completions endpoint takes tools only at `none`
   * (OpenAI's GPT-6 Sol: "Chat Completions supports function calling only
   * with reasoning_effort set to none"). */
  const offWithTools = {
    reasoning: { off: 'none' as const, toolsRequireOff: true },
  };

  it('is the catalog’s off on Chat Completions, where the model takes tools only there', () => {
    expect(
      upstreamFor(
        openai,
        model({ providerSlug: 'openai', modelId: 'gpt-6-sol' }),
        'openai-chat',
        offWithTools,
      ),
    ).toMatchObject({ wire: 'openai-chat', toolsEffort: 'none' });
    // A client on another wire translated onto Chat Completions too.
    expect(
      upstreamFor(
        { ...deepseek, harnessEndpoint: undefined },
        model(),
        'anthropic',
        { reasoning: { off: 'minimal', toolsRequireOff: true } },
      ),
    ).toMatchObject({ wire: 'openai-chat', toolsEffort: 'minimal' });
  });

  it('is nothing on the Responses API, which takes tools at any effort, nor for any other model', () => {
    // Codex on OpenAI's own API stays on the Responses wire.
    expect(
      upstreamFor(
        openai,
        model({ providerSlug: 'openai', modelId: 'gpt-6-sol' }),
        'openai-responses',
        offWithTools,
      ),
    ).not.toHaveProperty('toolsEffort');
    // A model that names an off value but takes tools at any effort.
    expect(
      upstreamFor(openai, model(), 'openai-chat', {
        reasoning: { off: 'none' },
      }),
    ).not.toHaveProperty('toolsEffort');
    expect(
      upstreamFor(openai, model(), 'openai-chat', undefined),
    ).not.toHaveProperty('toolsEffort');
    // An Anthropic upstream.
    expect(
      upstreamFor(
        deepseek,
        model({ anthropicLane: true }),
        'anthropic',
        offWithTools,
      ),
    ).not.toHaveProperty('toolsEffort');
  });
});
