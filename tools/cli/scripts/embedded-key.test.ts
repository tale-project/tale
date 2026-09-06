import { describe, expect, test } from 'bun:test';

import { toEmbeddedKey } from './embedded-key';

describe('toEmbeddedKey', () => {
  test('keeps POSIX-relative paths as-is under the prefix', () => {
    expect(toEmbeddedKey('builtin-configs', 'agents/research/agent.yml')).toBe(
      'builtin-configs/agents/research/agent.yml',
    );
  });

  test('emits POSIX keys for a backslash-separated (Windows) relative path', () => {
    // A Windows `path.relative()` yields backslashes; the key must still match
    // getEmbeddedExamples()'s literal `builtin-configs/<domain>/` prefix.
    expect(
      toEmbeddedKey('builtin-configs', 'agents\\research\\agent.yml'),
    ).toBe('builtin-configs/agents/research/agent.yml');
    expect(
      toEmbeddedKey('builtin-configs', 'governance\\policies\\default.yml'),
    ).toBe('builtin-configs/governance/policies/default.yml');
  });

  test('does not depend on the prefix for the separator', () => {
    expect(toEmbeddedKey('backend/core', 'agents\\loop.ts')).toBe(
      'backend/core/agents/loop.ts',
    );
    expect(toEmbeddedKey('lib', 'shared/constants/org-slug.ts')).toBe(
      'lib/shared/constants/org-slug.ts',
    );
  });

  test('never produces a backslash or an empty segment', () => {
    const key = toEmbeddedKey('builtin-configs', 'skills\\\\deep\\file.md');
    expect(key).toBe('builtin-configs/skills/deep/file.md');
    expect(key.includes('\\')).toBe(false);
    expect(key.split('/').every((s) => s.length > 0)).toBe(true);
  });
});
