import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyAdapters,
  expectedAdapterTree,
  planAdapters,
} from '../src/adapters';
import type { FileTree } from '../src/tree';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tale-skills-adapters-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Create .claude/skills/<name>/SKILL.md with the given frontmatter. */
function scaffoldSkill(
  name: string,
  description: string,
  frontmatterName = name,
): void {
  const dir = join(root, '.claude/skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${frontmatterName}\ndescription: ${description}\n---\n\n# ${name}\n\nBody.\n`,
  );
}

function writeGlobsFile(obj: Record<string, string[]>): void {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(
    join(root, '.claude/skill-globs.json'),
    JSON.stringify(obj, null, 2),
  );
}

function text(tree: FileTree, key: string): string {
  const bytes = tree.get(key);
  if (bytes === undefined) throw new Error(`expected adapter ${key} to exist`);
  return new TextDecoder().decode(bytes);
}

describe('expectedAdapterTree', () => {
  test('glob-scoped skill yields a Cursor rule (with globs) + a Copilot instruction', () => {
    scaffoldSkill('convex', 'How to write Convex code. Read before editing.');
    const { tree, errors } = expectedAdapterTree(
      root,
      new Map([['convex', ['services/platform/convex/**']]]),
    );
    expect(errors).toEqual([]);

    const cursor = text(tree, '.cursor/rules/convex.mdc');
    expect(cursor).toContain('description: How to write Convex code.'); // first sentence only
    expect(cursor).not.toContain('Read before editing'); // second sentence dropped
    expect(cursor).toContain('globs: services/platform/convex/**');
    expect(cursor).toContain('alwaysApply: false');
    expect(cursor).toContain('When working on matching code');
    expect(cursor).toContain(
      '[`convex` skill](../../.claude/skills/convex/SKILL.md)',
    );

    const copilot = text(tree, '.github/instructions/convex.instructions.md');
    expect(copilot).toContain("applyTo: 'services/platform/convex/**'");
    expect(copilot).toContain('When editing these files');

    const codex = text(tree, '.codex/skills/convex.md');
    expect(codex).toContain('# convex');
    expect(codex).toContain('How to write Convex code.'); // first sentence only
    expect(codex).toContain('This file only routes Codex to it');
  });

  test('joins multiple globs with commas', () => {
    scaffoldSkill('docker', 'The local stack.');
    const { tree } = expectedAdapterTree(
      root,
      new Map([
        ['docker', ['compose*.yml', '**/Dockerfile*', 'services/db/**']],
      ]),
    );
    expect(text(tree, '.cursor/rules/docker.mdc')).toContain(
      'globs: compose*.yml,**/Dockerfile*,services/db/**',
    );
    expect(text(tree, '.github/instructions/docker.instructions.md')).toContain(
      "applyTo: 'compose*.yml,**/Dockerfile*,services/db/**'",
    );
  });

  test('activity-scoped skill ([] globs) yields a Cursor rule (no globs) + Codex pointer, no Copilot', () => {
    scaffoldSkill('plan', 'How to plan a change.');
    const { tree } = expectedAdapterTree(root, new Map([['plan', []]]));
    const cursor = text(tree, '.cursor/rules/plan.mdc');
    expect(cursor).not.toContain('globs:');
    expect(cursor).toContain('When this guide applies');
    expect(tree.has('.codex/skills/plan.md')).toBe(true);
    expect(tree.has('.github/instructions/plan.instructions.md')).toBe(false);
  });

  test('reports a skill with no globs entry', () => {
    scaffoldSkill('orphan', 'No entry.');
    const { errors } = expectedAdapterTree(root, new Map());
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('orphan');
    expect(errors[0]).toContain('skill-globs.json');
  });

  test('reports a stale globs entry with no matching skill', () => {
    const { errors } = expectedAdapterTree(root, new Map([['ghost', []]]));
    expect(
      errors.some((e) => e.includes('ghost') && e.includes('no matching')),
    ).toBe(true);
  });

  test('reports a frontmatter name that disagrees with the directory', () => {
    scaffoldSkill('react', 'React UI.', 'reactjs');
    const { errors } = expectedAdapterTree(
      root,
      new Map([['react', ['packages/ui/**']]]),
    );
    expect(
      errors.some((e) => e.includes('frontmatter name is "reactjs"')),
    ).toBe(true);
  });
});

describe('planAdapters + applyAdapters', () => {
  test('no globs file => adapters unmanaged (clean, no errors)', () => {
    scaffoldSkill('convex', 'x.'); // skill exists, but no skill-globs.json
    const plan = planAdapters(root);
    expect(plan.errors).toEqual([]);
    expect(plan.expected.size).toBe(0);
    expect(plan.diff.changed).toEqual([]);
    expect(plan.diff.missing).toEqual([]);
    expect(plan.diff.extra).toEqual([]);
  });

  test('detects missing adapters, then a sync writes them and re-check is clean', async () => {
    scaffoldSkill('convex', 'Convex.');
    scaffoldSkill('plan', 'Plan.');
    writeGlobsFile({ convex: ['services/platform/convex/**'], plan: [] });

    const before = planAdapters(root);
    expect(before.diff.missing).toEqual([
      '.codex/skills/convex.md',
      '.codex/skills/plan.md',
      '.cursor/rules/convex.mdc',
      '.cursor/rules/plan.mdc',
      '.github/instructions/convex.instructions.md',
    ]);

    await applyAdapters(root, before);
    expect(existsSync(join(root, '.cursor/rules/convex.mdc'))).toBe(true);
    expect(
      existsSync(join(root, '.github/instructions/convex.instructions.md')),
    ).toBe(true);
    expect(
      existsSync(join(root, '.github/instructions/plan.instructions.md')),
    ).toBe(false);

    const after = planAdapters(root);
    expect(after.diff.missing).toEqual([]);
    expect(after.diff.changed).toEqual([]);
    expect(after.diff.extra).toEqual([]);
  });

  test('flags an edited adapter as changed, and a re-sync repairs it', async () => {
    scaffoldSkill('convex', 'Convex.');
    writeGlobsFile({ convex: ['services/platform/convex/**'] });
    await applyAdapters(root, planAdapters(root));

    writeFileSync(join(root, '.cursor/rules/convex.mdc'), 'tampered');
    expect(planAdapters(root).diff.changed).toEqual([
      '.cursor/rules/convex.mdc',
    ]);

    await applyAdapters(root, planAdapters(root));
    expect(planAdapters(root).diff.changed).toEqual([]);
  });

  test('preserves the hand-maintained tale.mdc (never flagged stale)', async () => {
    scaffoldSkill('convex', 'Convex.');
    writeGlobsFile({ convex: ['services/platform/convex/**'] });
    mkdirSync(join(root, '.cursor/rules'), { recursive: true });
    writeFileSync(
      join(root, '.cursor/rules/tale.mdc'),
      '---\nalwaysApply: true\n---\n',
    );
    await applyAdapters(root, planAdapters(root));

    const plan = planAdapters(root);
    expect(plan.diff.extra).toEqual([]); // tale.mdc excluded from the managed set
    expect(existsSync(join(root, '.cursor/rules/tale.mdc'))).toBe(true);
  });

  test('deletes a stale adapter whose skill was removed', async () => {
    scaffoldSkill('convex', 'Convex.');
    writeGlobsFile({ convex: ['services/platform/convex/**'] });
    await applyAdapters(root, planAdapters(root));

    // Drop the skill + its globs entry; the adapter files are now orphaned.
    rmSync(join(root, '.claude/skills/convex'), {
      recursive: true,
      force: true,
    });
    writeGlobsFile({});
    const plan = planAdapters(root);
    expect(plan.diff.extra).toContain('.cursor/rules/convex.mdc');

    await applyAdapters(root, plan);
    expect(existsSync(join(root, '.cursor/rules/convex.mdc'))).toBe(false);
  });
});
