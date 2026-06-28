# @tale/skills

Skill source-of-truth sync + cross-harness adapter generator for the Tale monorepo.

The [`skills/`](../../skills/) directory is the single source of truth for skills shared between the
repo and the product (and product-only skills). This tool keeps every downstream copy of a skill in
lockstep with that source, and reproduces the cross-tool pointers other harnesses read.

## What it syncs

- **Skill bundles** — `skills/<name>/` → `.claude/skills/<name>/` and/or `builtin-configs/skills/<name>/`,
  per each skill's `targets` in [`src/manifest.ts`](./src/manifest.ts).
- **Cross-harness adapters** — every `.claude/skills/<name>/SKILL.md` → its Cursor rule
  (`.cursor/rules/<name>.mdc`) and Codex pointer (`.codex/skills/<name>.md`), plus — for
  glob-scoped skills — its Copilot instruction (`.github/instructions/<name>.instructions.md`),
  using the globs in [`.claude/skill-globs.json`](../../.claude/skill-globs.json).

## What it guards (`--check`, run in CI as a test)

- No drift between a source and any committed copy or adapter (changed / missing / stale files).
- Shipped TypeScript skill scripts are self-contained (only `node:*`, `bun`/`bun:*`, relative imports).
- Every `bun scripts/…` / `python scripts/…` a `SKILL.md` references actually exists.
- Manifest + `skill-globs.json` sanity (kebab names, real `SKILL.md`, every skill has a globs entry).

## Usage

```bash
bun run skills:sync    # bun tools/skills/src/index.ts          — regenerate every copy + adapter
bun run skills:check   # bun tools/skills/src/index.ts --check  — verify; exit 1 on drift
```

The same check runs automatically under `bun test` (see `tests/repo-sync.test.ts`), so CI fails on
drift without a dedicated job.

## Scripts

```bash
bun run --filter @tale/skills typecheck
bun run --filter @tale/skills test
bun run --filter @tale/skills lint
```

The model — the three locations, how to add a skill, the runnable-script convention — is documented
in [`AGENTS.md`](../../AGENTS.md) (the skills section).
