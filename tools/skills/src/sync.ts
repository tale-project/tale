/**
 * Skill sync engine. Pure library — the CLI entry that runs it lives in
 * ./index.ts (kept separate so this stays side-effect-free and unit-testable).
 *
 * The repo keeps skills in three independent source roots, by audience:
 *   - `.agents/skills/`         repo-dev coding guides (docs). The SOURCE every
 *                               harness reads: Cursor / Codex / Copilot open it
 *                               directly; Claude Code reads its mirror under
 *                               `.claude/skills/`, which this tool regenerates.
 *   - `builtin-configs/skills/` product skills shipped to org agents (docx, pptx,
 *                               …) — embedded in the CLI binary + seeded per-org.
 *   - `skills/`                 self-contained Bun workspace skills baked into the
 *                               `services/sandbox-runtime` image (visual-aspect-analyzer).
 *
 * `runSync` does two things, in both modes:
 *   1. Mirrors `.agents/skills/` → `.claude/skills/` (the only generated copy).
 *   2. Guards the SHIPPED skill roots (`builtin-configs/skills/`, `skills/`)
 *      against the portability contract — a shipped skill whose code can't run
 *      where it lands, or whose SKILL.md points at a missing script, never passes.
 *
 * With `check: true` it writes nothing and returns exit 1 on drift or a guard
 * violation (run in CI as a test). Modelled on
 * `services/platform/scripts/check-schema-snapshot.ts`.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  checkCommandRefs,
  checkImports,
  type CommandRefViolation,
  type ImportViolation,
} from './guards';
import {
  diffTrees,
  expectedTargetTree,
  isClean,
  readTree,
  type FileTree,
  type TreeDiff,
} from './tree';

/** Repo-relative source of the repo-dev guides and the one mirror generated from it. */
const MIRROR_SOURCE = '.agents/skills';
const MIRROR_TARGET = '.claude/skills';

/**
 * Repo-relative roots whose skills ship to product/runtime agents and so must
 * honour the portability contract. `.agents/skills` is deliberately excluded —
 * it is docs-only and references repo paths, not skill-relative scripts.
 */
const SHIPPED_ROOTS: readonly string[] = ['builtin-configs/skills', 'skills'];

export interface SyncOptions {
  /** Absolute path to the repo root (the parent of `.agents/`). */
  readonly repoRoot: string;
  /** `true` = verify only, never write. */
  readonly check: boolean;
}

interface MirrorPlan {
  readonly expected: FileTree;
  readonly diff: TreeDiff;
}

/**
 * Resolve the expected `.claude/skills` tree (the source minus ship-excluded
 * files) and its drift against disk. Pure read — no writes.
 */
export function planMirror(repoRoot: string): MirrorPlan {
  const source = readTree(join(repoRoot, MIRROR_SOURCE));
  const expected = expectedTargetTree(source);
  const actual = readTree(join(repoRoot, MIRROR_TARGET));
  return { expected, diff: diffTrees(expected, actual) };
}

/** Skill directory names (dirs holding a `SKILL.md`) directly under `root`. */
function skillDirsIn(repoRoot: string, root: string): string[] {
  const abs = join(repoRoot, root);
  let names: string[];
  try {
    names = readdirSync(abs);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
  return names.filter((name) => existsSync(join(abs, name, 'SKILL.md'))).sort();
}

interface GuardPlan {
  readonly imports: readonly ImportViolation[];
  readonly commands: readonly CommandRefViolation[];
}

/**
 * Run the portability guards over every shipped skill. The skill label is its
 * repo-relative path (`builtin-configs/skills/pptx`) so a violation names the
 * exact bundle. Pure read.
 */
export function planGuards(repoRoot: string): GuardPlan {
  const imports: ImportViolation[] = [];
  const commands: CommandRefViolation[] = [];
  for (const root of SHIPPED_ROOTS) {
    for (const name of skillDirsIn(repoRoot, root)) {
      const label = `${root}/${name}`;
      const source = readTree(join(repoRoot, root, name));
      imports.push(...checkImports(label, source));
      commands.push(...checkCommandRefs(label, source));
    }
  }
  return { imports, commands };
}

/** Write missing+changed files and delete stale extras for the mirror. */
async function applyMirror(repoRoot: string, plan: MirrorPlan): Promise<void> {
  const targetDir = join(repoRoot, MIRROR_TARGET);
  const writes: Promise<number>[] = [];
  for (const rel of [...plan.diff.missing, ...plan.diff.changed]) {
    const bytes = plan.expected.get(rel);
    if (bytes !== undefined)
      writes.push(Bun.write(join(targetDir, rel), bytes));
  }
  for (const rel of plan.diff.extra) {
    rmSync(join(targetDir, rel), { force: true });
  }
  await Promise.all(writes);
}

function formatDrift(diff: TreeDiff): string {
  const lines = [
    '[skills:check] FAILED — the generated .claude/skills mirror is out of date.',
    '',
    `  ${MIRROR_SOURCE}/ -> ${MIRROR_TARGET}/`,
  ];
  if (diff.missing.length > 0) {
    lines.push(`    missing: ${diff.missing.join(', ')}`);
  }
  if (diff.changed.length > 0) {
    lines.push(`    changed: ${diff.changed.join(', ')}`);
  }
  if (diff.extra.length > 0) {
    lines.push(`    stale:   ${diff.extra.join(', ')}`);
  }
  lines.push(
    '',
    `${MIRROR_SOURCE}/ is the source of truth. Regenerate the mirror with:`,
    '',
    '    bun run skills:sync',
    '',
    'then commit the regenerated .claude/skills copy.',
  );
  return lines.join('\n');
}

function formatGuardFailures(plan: GuardPlan): string {
  const lines = [
    '[skills:check] FAILED — a shipped skill violates the portability contract.',
    '',
  ];
  if (plan.imports.length > 0) {
    lines.push(
      '  Non-self-contained import(s) in shipped TypeScript (a deployed skill has',
      '  no node_modules — only node:*, bun / bun:*, and relative paths resolve):',
    );
    for (const v of plan.imports) {
      lines.push(`    ${v.skill}/${v.file}: imports "${v.specifier}"`);
    }
    lines.push('');
  }
  if (plan.commands.length > 0) {
    lines.push('  SKILL.md references a script that does not exist:');
    for (const v of plan.commands) {
      lines.push(`    ${v.skill}: ${v.referenced}`);
    }
    lines.push('');
  }
  lines.push('Fix the shipped skill, then run: bun run skills:sync');
  return lines.join('\n');
}

/**
 * Run the sync. Returns a process exit code (0 ok, 1 drift/violation). The
 * portability guards run in BOTH modes — a shipped skill whose code can't run
 * where it lands is never synced or passed.
 */
export async function runSync(opts: SyncOptions): Promise<number> {
  const guards = planGuards(opts.repoRoot);
  if (guards.imports.length > 0 || guards.commands.length > 0) {
    console.error(formatGuardFailures(guards));
    return 1;
  }

  const mirror = planMirror(opts.repoRoot);

  if (!opts.check) {
    await applyMirror(opts.repoRoot, mirror);
    console.log(
      `[skills:sync] OK — mirrored ${mirror.expected.size} file(s) ` +
        `${MIRROR_SOURCE}/ -> ${MIRROR_TARGET}/.`,
    );
    return 0;
  }

  if (isClean(mirror.diff)) {
    console.log(
      '[skills:check] OK — the .claude/skills mirror matches its .agents/skills source.',
    );
    return 0;
  }

  console.error(formatDrift(mirror.diff));
  return 1;
}
