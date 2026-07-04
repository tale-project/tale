import { describe, expect, it } from 'vitest';

import {
  resolvePackReadinessHint,
  resolvePackReadinessOpenAgentLabel,
} from './pack_readiness_hint';

describe('resolvePackReadinessHint', () => {
  const labels = {
    'demoApp.readiness.mismatch.cursorKeyOnClaudeRuntime':
      '{agent} needs a runtime fix.',
    'demoApp.readiness.openAgent': 'Open settings',
  };

  it('resolves a pack hint from messageNamespace + mismatch code', () => {
    expect(
      resolvePackReadinessHint(
        'demoApp',
        labels,
        {
          code: 'cursorKeyOnClaudeRuntime',
          expectedKeys: ['ANTHROPIC_AUTH_TOKEN'],
          configuredKeys: ['CURSOR_API_KEY'],
        },
        'Worker',
      ),
    ).toBe('Worker needs a runtime fix.');
  });

  it('returns undefined when the pack ships no label for the code', () => {
    expect(
      resolvePackReadinessHint(
        'demoApp',
        labels,
        {
          code: 'claudeKeyOnCursorRuntime',
          expectedKeys: ['CURSOR_API_KEY'],
          configuredKeys: ['ANTHROPIC_AUTH_TOKEN'],
        },
        'Worker',
      ),
    ).toBeUndefined();
  });

  it('resolves the open-agent button label from the pack', () => {
    expect(resolvePackReadinessOpenAgentLabel('demoApp', labels)).toBe(
      'Open settings',
    );
  });
});
