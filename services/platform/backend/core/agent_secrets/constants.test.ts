import { describe, expect, it } from 'vitest';

import {
  maskAgentSecretPreview,
  validateAgentSecretName,
  validateAgentSecretValue,
} from './constants';

describe('validateAgentSecretName', () => {
  it('accepts a valid env var name', () => {
    expect(validateAgentSecretName('GLITCHTIP_TOKEN').ok).toBe(true);
    expect(validateAgentSecretName('_x0').ok).toBe(true);
  });

  it('rejects empty, digit-leading, and punctuated names', () => {
    expect(validateAgentSecretName('').ok).toBe(false);
    expect(validateAgentSecretName('0TOKEN').ok).toBe(false);
    expect(validateAgentSecretName('MY-TOKEN').ok).toBe(false);
    expect(validateAgentSecretName('a b').ok).toBe(false);
  });
});

describe('validateAgentSecretValue', () => {
  it('rejects an empty value', () => {
    expect(validateAgentSecretValue('').ok).toBe(false);
  });

  it('accepts a normal token', () => {
    expect(validateAgentSecretValue('ghp_abcdef1234').ok).toBe(true);
  });
});

describe('maskAgentSecretPreview', () => {
  it('reveals a small edge slice for a long secret', () => {
    expect(maskAgentSecretPreview('ghp_abcdefghijklmnop')).toBe('ghp_••••nop');
  });

  it('returns undefined for a secret too short to reveal safely', () => {
    expect(maskAgentSecretPreview('short')).toBeUndefined();
  });

  it('never leaks length (constant-width mask)', () => {
    const a = maskAgentSecretPreview('ghp_' + 'x'.repeat(10));
    const b = maskAgentSecretPreview('ghp_' + 'x'.repeat(40));
    expect(a?.length).toBe(b?.length);
  });
});
