import { describe, expect, it } from 'vitest';

import { buildAgentEnvSetArgs, type KeyDraft } from './agent-secrets-step';

describe('buildAgentEnvSetArgs', () => {
  it('maps a secret draft to isSecret with the trimmed value', () => {
    const draft: KeyDraft = { type: 'secret', value: '  sk-abc  ' };
    expect(buildAgentEnvSetArgs(draft)).toEqual({
      value: 'sk-abc',
      isSecret: true,
    });
  });

  it('maps a plain value draft to isSecret: false', () => {
    expect(buildAgentEnvSetArgs({ type: 'value', value: 'plain' })).toEqual({
      value: 'plain',
      isSecret: false,
    });
  });

  it('skips empty value/secret drafts', () => {
    expect(buildAgentEnvSetArgs({ type: 'secret', value: '  ' })).toBeNull();
    expect(buildAgentEnvSetArgs({ type: 'value', value: '' })).toBeNull();
  });

  it('maps a token-source draft to a binding (empty value + slug)', () => {
    expect(
      buildAgentEnvSetArgs({
        type: 'token-source',
        value: 'ignored',
        tokenSourceSlug: 'anthropic-pool',
      }),
    ).toEqual({
      value: '',
      isSecret: true,
      tokenSourceSlug: 'anthropic-pool',
    });
  });

  it('skips a token-source draft with no slug', () => {
    expect(
      buildAgentEnvSetArgs({ type: 'token-source', value: '' }),
    ).toBeNull();
  });
});
