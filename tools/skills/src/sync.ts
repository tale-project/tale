/**
 * Skill sync engine. Pure library — the CLI entry that runs it lives in
 * ./index.ts (kept separate so this stays side-effect-free and unit-testable).
 *
 * `skills/` is the source of truth for skills shared with the product
 * (`builtin-configs/skills/`) and/or the repo-dev agents (`.claude/skills/`).
 * `runSync` regenerates those committed copies from the source — plus the
 * cross-harness adapters (.cursor / .github/instructions) — and, with
 * `check: true`, verifies in CI that nothing has drifted and that every shipped
 * skill honours the portability contract (self-contained imports + live command
 * references). Modelled on `services/platform/scripts/check-schema-snapshot.ts`.
 */

import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { applyAdapters, planAdapters } from './adapters';
import {
  checkCommandRefs,
  checkImports,
  type CommandRefViolation,
  type ImportViolation,
} from './guards';
import type { SkillManifestEntry, SkillTarget } from './manifest';
import { validateManifest } from './manifest-validate';
import {
  diffTrees,
  expectedTargetTree,
  isClean,
  readTree,
  type FileTree,
  type TreeDiff,
} from './tree';

/** Repo-relative parent directory for each sync target. */
const TARGET_ROOT: Record<SkillTarget, string> = {
  claude: '.claude/skills',
  builtin: 'builtin-configs/skills',
};

interface TargetPlan {
  readonly target: SkillTarget;
  readonly targetDir: string; // absolute
  readonly expected: FileTree;
  readonly diff: TreeDiff;
}

interface SkillPlan {
  readonly name: string;
  readonly targets: readonly TargetPlan[];
  readonly importViolations: readonly ImportViolation[];
  readonly commandViolations: readonly CommandRefViolation[];
}

export interface SyncOptions {
  /** Absolute path to the repo root (the parent of `skills/`). */
  readonly repoRoot: string;
  readonly manifest: readonly SkillManifestEntry[];
  /** `true` = verify only, never write. */
  readonly check: boolean;
}

/**
 * Resolve every (skill, target) pair to its expected tree, on-disk diff, and
 * guard results. Pure read — no writes.
 */
export function planSync(opts: SyncOptions): SkillPlan[] {
  return opts.manifest.map((entry) => {
    const source = readTree(join(opts.repoRoot, 'skills', entry.name));
    const expected = expectedTargetTree(source);
    const targets = entry.targets.map<TargetPlan>((target) => {
      const targetDir = join(opts.repoRoot, TARGET_ROOT[target], entry.name);
      const actual = readTree(targetDir);
      return { target, targetDir, expected, diff: diffTrees(expected, actual) };
    });
    return {
      name: entry.name,
      targets,
      importViolations: checkImports(entry.name, source),
      commandViolations: checkCommandRefs(entry.name, source),
    };
  });
}

/** Write missing+changed files and delete stale extras for every target. */
async function applyPlan(plans: readonly SkillPlan[]): Promise<void> {
  const writes: Promise<number>[] = [];
  for (const plan of plans) {
    for (const t of plan.targets) {
      for (const rel of [...t.diff.missing, ...t.diff.changed]) {
        const bytes = t.expected.get(rel);
        if (bytes !== undefined) {
          writes.push(Bun.write(join(t.targetDir, rel), bytes));
        }
      }
      for (const rel of t.diff.extra) {
        rmSync(join(t.targetDir, rel), { force: true });
      }
    }
  }
  await Promise.all(writes);
}

interface DriftedSkill {
  readonly name: string;
  readonly targets: readonly TargetPlan[];
}

function formatDrift(
  drifted: readonly DriftedSkill[],
  adapterDiff: TreeDiff,
): string {
  const lines = [
    '[skills:check] FAILED — generated skill copies / adapters are out of date.',
    '',
  ];
  for (const skill of drifted) {
    for (const t of skill.targets) {
      lines.push(`  ${skill.name} -> ${TARGET_ROOT[t.target]}/${skill.name}`);
      const dirGone =
        t.expected.size > 0 && t.diff.missing.length === t.expected.size;
      if (dirGone) {
        lines.push('    missing: <entire target directory absent>');
      } else if (t.diff.missing.length > 0) {
        lines.push(`    missing: ${t.diff.missing.join(', ')}`);
      }
      if (t.diff.changed.length > 0) {
        lines.push(`    changed: ${t.diff.changed.join(', ')}`);
      }
      if (t.diff.extra.length > 0) {
        lines.push(`    stale:   ${t.diff.extra.join(', ')}`);
      }
    }
  }
  if (!isClean(adapterDiff)) {
    lines.push(
      '  cross-harness adapters (.cursor/rules + .github/instructions)',
    );
    if (adapterDiff.missing.length > 0) {
      lines.push(`    missing: ${adapterDiff.missing.join(', ')}`);
    }
    if (adapterDiff.changed.length > 0) {
      lines.push(`    changed: ${adapterDiff.changed.join(', ')}`);
    }
    if (adapterDiff.extra.length > 0) {
      lines.push(`    stale:   ${adapterDiff.extra.join(', ')}`);
    }
  }
  lines.push(
    '',
    'The skills/ sources + each SKILL.md are the source of truth. Regenerate with:',
    '',
    '    bun run skills:sync',
    '',
    'then commit the regenerated copies and adapters.',
  );
  return lines.join('\n');
}

function formatGuardFailures(
  imports: readonly ImportViolation[],
  commands: readonly CommandRefViolation[],
  adapterErrors: readonly string[],
): string {
  const lines = [
    '[skills:check] FAILED — skill / adapter source is invalid.',
    '',
  ];
  if (imports.length > 0) {
    lines.push(
      '  Non-self-contained import(s) in shipped TypeScript (a deployed skill has',
      '  no node_modules — only node:*, bun / bun:*, and relative paths resolve):',
    );
    for (const v of imports) {
      lines.push(`    ${v.skill}/${v.file}: imports "${v.specifier}"`);
    }
    lines.push('');
  }
  if (commands.length > 0) {
    lines.push('  SKILL.md references a script that does not exist:');
    for (const v of commands) {
      lines.push(`    ${v.skill}: ${v.referenced}`);
    }
    lines.push('');
  }
  if (adapterErrors.length > 0) {
    lines.push(
      '  Cross-harness adapter source problem(s) (.claude/skill-globs.json / SKILL.md frontmatter):',
    );
    for (const error of adapterErrors) {
      lines.push(`    ${error}`);
    }
    lines.push('');
  }
  lines.push('Fix the source, then run: bun run skills:sync');
  return lines.join('\n');
}

/**
 * Run the sync. Returns a process exit code (0 ok, 1 drift/violation). Validates
 * the manifest, the portability guards, and the adapter source in BOTH modes — a
 * skill whose shipped code can't run where it lands, or whose adapter source is
 * misconfigured, is never synced or passed.
 */
export async function runSync(opts: SyncOptions): Promise<number> {
  validateManifest(opts.manifest, opts.repoRoot);

  const plans = planSync(opts);
  const adapters = planAdapters(opts.repoRoot);

  const importViolations = plans.flatMap((p) => p.importViolations);
  const commandViolations = plans.flatMap((p) => p.commandViolations);
  if (
    importViolations.length > 0 ||
    commandViolations.length > 0 ||
    adapters.errors.length > 0
  ) {
    console.error(
      formatGuardFailures(importViolations, commandViolations, adapters.errors),
    );
    return 1;
  }

  if (!opts.check) {
    await applyPlan(plans);
    await applyAdapters(opts.repoRoot, adapters);
    const targetCount = plans.reduce((sum, p) => sum + p.targets.length, 0);
    const fileCount = plans.reduce(
      (sum, p) => sum + p.targets.reduce((s, t) => s + t.expected.size, 0),
      0,
    );
    console.log(
      `[skills:sync] OK — synced ${plans.length} skill(s) into ${targetCount} ` +
        `target(s) (${fileCount} file(s)) + ${adapters.expected.size} cross-harness adapter(s).`,
    );
    return 0;
  }

  const drifted: DriftedSkill[] = plans
    .map((p) => ({
      name: p.name,
      targets: p.targets.filter((t) => !isClean(t.diff)),
    }))
    .filter((p) => p.targets.length > 0);

  if (drifted.length === 0 && isClean(adapters.diff)) {
    console.log(
      '[skills:check] OK — every synced copy and cross-harness adapter matches the source.',
    );
    return 0;
  }

  console.error(formatDrift(drifted, adapters.diff));
  return 1;
}
