/**
 * Manifest of skills whose source of truth lives under `skills/`. This is the
 * ONLY enumeration the sync engine reads — it never globs `.claude/skills/`, so
 * the hand-authored coding-guide skills there are never touched by the sync.
 *
 * Each entry's `targets` decide where `bun run skills:sync` writes a committed
 * copy of the skill:
 *   - 'claude'  -> .claude/skills/<name>/         (repo-dev agents: Claude Code / Cursor / Copilot)
 *   - 'builtin' -> builtin-configs/skills/<name>/ (shipped to product agents: embedded in the CLI
 *                  binary, baked into the sandbox-runtime image, deployed per-org at chat time)
 *
 * Taxonomy (see AGENTS.md "Shared & product skills" for the full model + how to add a skill):
 *   - Repo-only skill    -> NOT here; lives only in .claude/skills/, hand-authored.
 *   - Shared skill       -> here with targets ['claude', 'builtin'].
 *   - Builtin-only skill -> here with targets ['builtin'].
 */

/** A sync destination for a skill. */
export type SkillTarget = 'claude' | 'builtin';

/** One row of the manifest: a skill directory under `skills/` and where it syncs. */
export interface SkillManifestEntry {
  /** Directory name under `skills/` (kebab-case); also the synced target dir name. */
  readonly name: string;
  /** Non-empty set of sync destinations. */
  readonly targets: readonly SkillTarget[];
}

// Register a skill here ONLY when it is SHARED across targets — its source under
// `skills/<name>/` is synced into `.claude/skills/` and/or `builtin-configs/skills/`.
// Two kinds of skill are deliberately NOT here:
//   - builtin-ONLY skills (e.g. pptx) live directly under `builtin-configs/skills/`,
//     hand-maintained, and ship to product agents from there (CLI embed + per-org seed).
//   - the `@tale/visual-aspect-analyzer` workspace under `skills/` is baked into the
//     sandbox-runtime image, not synced.
export const SKILLS_MANIFEST =
  [] as const satisfies readonly SkillManifestEntry[];
