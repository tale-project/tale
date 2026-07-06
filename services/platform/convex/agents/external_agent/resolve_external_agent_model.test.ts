import { describe, expect, it } from 'vitest';

import {
  externalAgentVkAllowlist,
  pickExternalAgentExecFallback,
  resolveExternalAgentModelRefs,
} from './resolve_external_agent_model';

const GOV = {
  providerName: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4-6',
};
const PLATFORM = {
  providerName: 'openrouter',
  modelId: 'anthropic/claude-haiku-4-5',
};

describe('resolveExternalAgentModelRefs', () => {
  it('BYO empty: uses member governance default', () => {
    expect(
      resolveExternalAgentModelRefs({
        authMode: 'byo',
        gatewayManaged: false,
        supportedModels: [],
        governanceDefault: GOV,
      }),
    ).toEqual({
      primaryModelRef: 'openrouter:anthropic/claude-sonnet-4-6',
      agentFallbackRefs: [],
    });
  });

  it('BYO empty with no governance default: unpinned credential default', () => {
    expect(
      resolveExternalAgentModelRefs({
        authMode: 'byo',
        gatewayManaged: false,
        supportedModels: [],
        governanceDefault: null,
      }),
    ).toEqual({ primaryModelRef: 'default', agentFallbackRefs: [] });
  });

  it('BYO non-empty: uses configured list only (primary + tail fallbacks)', () => {
    expect(
      resolveExternalAgentModelRefs({
        authMode: 'byo',
        gatewayManaged: false,
        supportedModels: ['claude-opus-4-8', 'claude-sonnet-4-6'],
        governanceDefault: GOV,
      }),
    ).toEqual({
      primaryModelRef: 'claude-opus-4-8',
      agentFallbackRefs: ['claude-sonnet-4-6'],
    });
  });

  it('managed gateway empty: org governance default, then platform default', () => {
    expect(
      resolveExternalAgentModelRefs({
        authMode: 'managed',
        gatewayManaged: true,
        supportedModels: [],
        governanceDefault: GOV,
      }),
    ).toEqual({
      primaryModelRef: 'openrouter:anthropic/claude-sonnet-4-6',
      agentFallbackRefs: [],
    });

    expect(
      resolveExternalAgentModelRefs({
        authMode: 'managed',
        gatewayManaged: true,
        supportedModels: [],
        governanceDefault: null,
        platformDefault: PLATFORM,
      }),
    ).toEqual({
      primaryModelRef: 'openrouter:anthropic/claude-haiku-4-5',
      agentFallbackRefs: [],
    });
  });

  it('managed gateway with explicit list: primary + agent fallbacks', () => {
    expect(
      resolveExternalAgentModelRefs({
        authMode: 'managed',
        gatewayManaged: true,
        supportedModels: [
          'openrouter:~anthropic/claude-fable-latest',
          'openrouter:anthropic/claude-opus-4.8',
        ],
        governanceDefault: GOV,
      }),
    ).toEqual({
      primaryModelRef: 'openrouter:~anthropic/claude-fable-latest',
      agentFallbackRefs: ['openrouter:anthropic/claude-opus-4.8'],
    });
  });

  it('explicit user override wins and preserves tail fallbacks', () => {
    expect(
      resolveExternalAgentModelRefs({
        authMode: 'managed',
        gatewayManaged: true,
        supportedModels: [
          'openrouter:anthropic/claude-fable-5',
          'openrouter:anthropic/claude-opus-4.8',
        ],
        explicitModelRef: 'openrouter:anthropic/claude-opus-4.8',
        governanceDefault: GOV,
      }),
    ).toEqual({
      primaryModelRef: 'openrouter:anthropic/claude-opus-4.8',
      agentFallbackRefs: ['openrouter:anthropic/claude-fable-5'],
    });
  });
});

describe('pickExternalAgentExecFallback', () => {
  it('prefers the first agent fallback over the catalog fallback', () => {
    expect(
      pickExternalAgentExecFallback(
        ['openrouter:anthropic/claude-opus-4.8'],
        'openrouter/anthropic/claude-haiku-4-5',
      ),
    ).toBe('openrouter:anthropic/claude-opus-4.8');
  });

  it('falls back to the catalog gateway model when the agent list is empty', () => {
    expect(
      pickExternalAgentExecFallback([], 'openrouter:anthropic/claude-opus-4.8'),
    ).toBe('openrouter:anthropic/claude-opus-4.8');
  });
});

describe('externalAgentVkAllowlist', () => {
  it('includes primary, agent fallbacks, catalog fallback, and vision ref', () => {
    expect(
      externalAgentVkAllowlist(
        'openrouter:anthropic/claude-fable-5',
        ['openrouter:anthropic/claude-opus-4.8'],
        'openrouter:anthropic/claude-haiku-4-5',
        'openrouter:anthropic/claude-sonnet-4-6',
      ),
    ).toEqual([
      'openrouter:anthropic/claude-fable-5',
      'openrouter:anthropic/claude-opus-4.8',
      'openrouter:anthropic/claude-haiku-4-5',
      'openrouter:anthropic/claude-sonnet-4-6',
    ]);
  });

  it('drops default sentinels and empty refs', () => {
    expect(
      externalAgentVkAllowlist('default', [], undefined, undefined),
    ).toEqual([]);
  });
});
