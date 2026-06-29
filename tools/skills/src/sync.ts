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
 * A subset of the product skills — the {@link WORKFLOW_SKILLS} (implement-feature,
 * fix-bug, …) — are ALSO repo-dev guides: generic, portable senior-dev workflows
 * that serve both org agents and the agents working on this repo. Their single
 * source of truth is `builtin-configs/skills/<name>/`; this tool PROJECTS them
 * into `.agents/skills/<name>/`, from where the mirror copies them to
 * `.claude/skills/`. The product-only skills (docx/pdf/pptx/xlsx) are NOT
 * projected.
 *
 * `runSync` does three things, in both modes:
 *   1. Guards the SHIPPED skill roots (`builtin-configs/skills/`, `skills/`)
 *      against the portability contract — a shipped skill whose code can't run
 *      where it lands, or whose SKILL.md points at a missing script, never passes.
 *   2. Projects `builtin-configs/skills/<workflow>/` → `.agents/skills/<workflow>/`
 *      (the generated copy a repo-dev harness reads; never hand-edit it).
 *   3. Mirrors `.agents/skills/` → `.claude/skills/` (the only Claude Code copy).
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

/** Repo-relative source of truth for product skills (and the workflow guides below). */
const PRODUCT_SOURCE = 'builtin-configs/skills';

/**
 * Product skills that are ALSO repo-dev guides. Their source of truth lives in
 * `builtin-configs/skills/<name>/` (so they ship to org agents); this tool
 * projects each into `.agents/skills/<name>/`, which the mirror then copies into
 * `.claude/skills/`. The remaining `builtin-configs/skills` entries (docx, pdf,
 * pptx, xlsx) are product-only and are deliberately NOT projected — they are not
 * repo-dev guides. This list is the registry the directory layout can't express.
 */
const WORKFLOW_SKILLS: readonly string[] = [
  'implement-feature',
  'make-improvement',
  'fix-bug',
  'review-code',
  'create-pr',
  'review-pr',
  'test-code',
  'write-notes',
];

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

/** One workflow skill's projection plan: its expected `.agents/skills` tree + drift. */
interface ProjectionPlan {
  readonly name: string;
  readonly expected: FileTree;
  readonly diff: TreeDiff;
}

/**
 * Resolve, for each {@link WORKFLOW_SKILLS} entry, the expected
 * `.agents/skills/<name>` tree (its `builtin-configs/skills/<name>` source minus
 * ship-excluded files) and its drift against the projected copy on disk. Pure
 * read — no writes.
 */
export function planProjection(repoRoot: string): ProjectionPlan[] {
  return WORKFLOW_SKILLS.map((name) => {
    const source = readTree(join(repoRoot, PRODUCT_SOURCE, name));
    const expected = expectedTargetTree(source);
    const actual = readTree(join(repoRoot, MIRROR_SOURCE, name));
    return { name, expected, diff: diffTrees(expected, actual) };
  });
}

/**
 * Workflow skills whose `builtin-configs/skills` source is gone but whose
 * projected `.agents/skills/<name>/` copy still exists. Projecting an empty
 * source over a real guide would WIPE it, so this is a hard error — restore the
 * source or drop the name from {@link WORKFLOW_SKILLS}; never a silent deletion.
 * A workflow skill absent from BOTH places is simply not-yet-authored and
 * projects as a clean no-op.
 */
function dangerouslyMissingProjections(repoRoot: string): string[] {
  return WORKFLOW_SKILLS.filter(
    (name) =>
      !existsSync(join(repoRoot, PRODUCT_SOURCE, name, 'SKILL.md')) &&
      existsSync(join(repoRoot, MIRROR_SOURCE, name)),
  );
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

/** Write missing+changed files and delete stale extras for one tree target. */
async function applyTree(
  targetDir: string,
  expected: FileTree,
  diff: TreeDiff,
): Promise<void> {
  const writes: Promise<number>[] = [];
  for (const rel of [...diff.missing, ...diff.changed]) {
    const bytes = expected.get(rel);
    if (bytes !== undefined)
      writes.push(Bun.write(join(targetDir, rel), bytes));
  }
  for (const rel of diff.extra) {
    rmSync(join(targetDir, rel), { force: true });
  }
  await Promise.all(writes);
}

/** Project every workflow skill into `.agents/skills/<name>`. */
async function applyProjection(
  repoRoot: string,
  plans: readonly ProjectionPlan[],
): Promise<void> {
  for (const plan of plans) {
    await applyTree(
      join(repoRoot, MIRROR_SOURCE, plan.name),
      plan.expected,
      plan.diff,
    );
  }
}

function formatMirrorDrift(diff: TreeDiff): string {
  const lines = [
    '[skills:check] FAILED — the generated .claude/skills mirror is out of date.',
    '',
    `  ${MIRROR_SOURCE}/ -> ${MIRROR_TARGET}/`,
  ];
  if (diff.missing.length > 0)
    lines.push(`    missing: ${diff.missing.join(', ')}`);
  if (diff.changed.length > 0)
    lines.push(`    changed: ${diff.changed.join(', ')}`);
  if (diff.extra.length > 0)
    lines.push(`    stale:   ${diff.extra.join(', ')}`);
  lines.push(
    '',
    `${MIRROR_SOURCE}/ is the source of truth for the mirror. Regenerate it with:`,
    '',
    '    bun run skills:sync',
    '',
    'then commit the regenerated .claude/skills copy.',
  );
  return lines.join('\n');
}

function formatProjectionDrift(drift: readonly ProjectionPlan[]): string {
  const lines = [
    '[skills:check] FAILED — a workflow-skill projection is out of date.',
    '',
    `  ${PRODUCT_SOURCE}/<name>/ -> ${MIRROR_SOURCE}/<name>/`,
    '',
  ];
  for (const p of drift) {
    lines.push(`  ${p.name}:`);
    if (p.diff.missing.length > 0)
      lines.push(`    missing: ${p.diff.missing.join(', ')}`);
    if (p.diff.changed.length > 0)
      lines.push(`    changed: ${p.diff.changed.join(', ')}`);
    if (p.diff.extra.length > 0)
      lines.push(`    stale:   ${p.diff.extra.join(', ')}`);
  }
  lines.push(
    '',
    `${PRODUCT_SOURCE}/<name>/ is the source of truth for workflow skills — edit it`,
    `there, never the generated ${MIRROR_SOURCE}/<name>/ copy. Then run:`,
    '',
    '    bun run skills:sync',
    '',
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
 * where it lands is never synced or passed. The projection runs before the
 * mirror so a sync picks up freshly-projected workflow skills.
 */
export async function runSync(opts: SyncOptions): Promise<number> {
  const guards = planGuards(opts.repoRoot);
  if (guards.imports.length > 0 || guards.commands.length > 0) {
    console.error(formatGuardFailures(guards));
    return 1;
  }

  const dangerous = dangerouslyMissingProjections(opts.repoRoot);
  if (dangerous.length > 0) {
    console.error(
      `[skills:check] FAILED — workflow skill(s) have a projected ${MIRROR_SOURCE}/ copy ` +
        `but no ${PRODUCT_SOURCE}/ source: ${dangerous.join(', ')}.\nRestore the SKILL.md ` +
        'source or drop the name from WORKFLOW_SKILLS in tools/skills/src/sync.ts.',
    );
    return 1;
  }

  const projection = planProjection(opts.repoRoot);

  if (!opts.check) {
    await applyProjection(opts.repoRoot, projection);
    // Re-plan the mirror AFTER projecting so it sees the freshly-projected copies.
    const mirror = planMirror(opts.repoRoot);
    await applyTree(
      join(opts.repoRoot, MIRROR_TARGET),
      mirror.expected,
      mirror.diff,
    );
    const projected = projection.reduce((n, p) => n + p.expected.size, 0);
    console.log(
      `[skills:sync] OK — projected ${projected} workflow file(s) ${PRODUCT_SOURCE}/ -> ` +
        `${MIRROR_SOURCE}/ and mirrored ${mirror.expected.size} file(s) ` +
        `${MIRROR_SOURCE}/ -> ${MIRROR_TARGET}/.`,
    );
    return 0;
  }

  const projDrift = projection.filter((p) => !isClean(p.diff));
  const mirror = planMirror(opts.repoRoot);
  const mirrorClean = isClean(mirror.diff);

  if (projDrift.length === 0 && mirrorClean) {
    console.log(
      '[skills:check] OK — workflow projections and the .claude/skills mirror match their sources.',
    );
    return 0;
  }

  if (projDrift.length > 0) console.error(formatProjectionDrift(projDrift));
  if (!mirrorClean) console.error(formatMirrorDrift(mirror.diff));
  return 1;
}
