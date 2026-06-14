import { describe, expect, test } from 'bun:test';

import { buildClaudeReference, upsertManagedSection } from './content';

describe('upsertManagedSection', () => {
  test('creates a managed block when there is no existing file', () => {
    const out = upsertManagedSection(null, 'hello body');
    expect(out).toContain('tale:begin');
    expect(out).toContain('hello body');
    expect(out).toContain('tale:end');
  });

  test('treats a blank file like a missing one', () => {
    expect(upsertManagedSection('  \n\n', 'body')).toBe(
      upsertManagedSection(null, 'body'),
    );
  });

  test('replaces a prior managed block in place, preserving surrounding content', () => {
    const initial = `# My own notes\n\n${upsertManagedSection(null, 'OLD').trim()}\n\n## Keep this footer`;
    const out = upsertManagedSection(initial, 'NEW');
    expect(out).toContain('# My own notes');
    expect(out).toContain('## Keep this footer');
    expect(out).toContain('NEW');
    expect(out).not.toContain('OLD');
    // Exactly one managed block — never duplicated on re-run.
    expect(out.split('tale:begin').length - 1).toBe(1);
  });

  test('appends the block to a file with no prior block, preserving user content', () => {
    const out = upsertManagedSection('# User content\n', 'managed body');
    expect(out.startsWith('# User content')).toBe(true);
    expect(out).toContain('managed body');
    expect(out).toContain('tale:begin');
  });

  test('is idempotent: re-running with the same body is a no-op', () => {
    const once = upsertManagedSection('# Keep me\n', 'body');
    expect(upsertManagedSection(once, 'body')).toBe(once);
  });
});

describe('buildClaudeReference', () => {
  test('points CLAUDE.md at the given agents file', () => {
    const out = buildClaudeReference('AGENTS.md');
    expect(out).toContain('AGENTS.md');
    expect(out.toLowerCase()).toContain('claude code');
  });
});
