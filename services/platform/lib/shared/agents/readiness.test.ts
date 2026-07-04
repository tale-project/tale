import { describe, expect, it } from 'vitest';

import { classifyAgentReadiness } from './readiness';

describe('classifyAgentReadiness', () => {
  it('classifies a chat agent as internal needing provider+model', () => {
    const r = classifyAgentReadiness({
      supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
    });
    expect(r.mode).toBe('internal');
    expect(r.needsProviderModel).toBe(true);
    expect(r.needsEnv).toBe(false);
    expect(r.providers).toEqual(['openrouter']);
  });

  it('classifies an image-generation agent as image needing provider+model', () => {
    const r = classifyAgentReadiness({
      primaryBehavior: 'image-generation',
      supportedModels: ['openrouter:black-forest-labs/flux.2-pro'],
    });
    expect(r.mode).toBe('image');
    expect(r.needsProviderModel).toBe(true);
    expect(r.needsEnv).toBe(false);
  });

  it('classifies a gateway-managed external agent as external-gateway-managed', () => {
    const r = classifyAgentReadiness({
      primaryBehavior: 'external-agent',
      authMode: 'managed',
      supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
    });
    expect(r.mode).toBe('external-gateway-managed');
    expect(r.needsProviderModel).toBe(true);
    expect(r.needsEnv).toBe(false);
  });

  it('defaults an external agent with no authMode to gateway-managed', () => {
    const r = classifyAgentReadiness({
      primaryBehavior: 'external-agent',
      supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
    });
    expect(r.mode).toBe('external-gateway-managed');
  });

  it('classifies an env-managed external agent as external-env-managed', () => {
    const r = classifyAgentReadiness({
      primaryBehavior: 'external-agent',
      authMode: 'managed',
      credentialManagedSource: 'agent-env',
      supportedModels: ['gpt-4'],
      requiredEnv: [{ key: 'CURSOR_API_KEY', secret: true }],
    });
    expect(r.mode).toBe('external-env-managed');
    expect(r.needsProviderModel).toBe(false);
    expect(r.needsEnv).toBe(true);
  });

  it('classifies a BYO external agent as external-byo needing env, not provider+model', () => {
    const r = classifyAgentReadiness({
      primaryBehavior: 'external-agent',
      authMode: 'byo',
      // Has supportedModels, but BYO never needs a provider key.
      supportedModels: ['openrouter:anthropic/claude-sonnet-4.6'],
      requiredEnv: [{ key: 'ANTHROPIC_AUTH_TOKEN', secret: true }],
    });
    expect(r.mode).toBe('external-byo');
    expect(r.needsEnv).toBe(true);
    expect(r.needsProviderModel).toBe(false);
    expect(r.requiredEnv).toEqual([
      { key: 'ANTHROPIC_AUTH_TOKEN', secret: true },
    ]);
  });

  it('dedupes providers and defaults secret to false', () => {
    const r = classifyAgentReadiness({
      supportedModels: [
        'openrouter:anthropic/claude-sonnet-4.6',
        'openrouter:anthropic/claude-opus-4.6',
        'bare-model-id',
      ],
      requiredEnv: [{ key: 'FOO' }],
    });
    expect(r.providers).toEqual(['openrouter']); // bare ref contributes no provider
    expect(r.requiredEnv[0]).toEqual({ key: 'FOO', secret: false });
  });
});
