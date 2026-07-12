# @tale/skills

Mirror sync + portability guard for the Tale monorepo's skills.

Skills live in two independent source roots, by audience:

- **`.agents/skills/`** — repo-dev coding guides (docs). The source every coding agent reads: Cursor,
  Codex, and Copilot open it directly; Claude Code reads the generated **`.claude/skills/`** mirror,
  which this tool regenerates.
- **`builtin-configs/skills/`** — product skills shipped to org agents: embedded in the CLI binary,
  seeded per-org at chat time. Hand-maintained. The document skills (`docx`, `pptx`, …) are
  product-only; the **workflow skills** (`implement-feature`, `fix-bug`, … — the `WORKFLOW_SKILLS`
  allowlist in `src/sync.ts`) are generic senior-dev guides that ALSO serve repo-dev agents, so this
  tool projects each into `.agents/skills/<name>/` (and from there into the mirror). Every skill
  here is included the same way — `visual-aspect-analyzer`, a self-contained Bun workspace, is
  projected too (repo-dev agents run it as the visual gate) and additionally baked into the
  `services/sandbox-runtime` image with its deps installed; that baked copy wins in sandbox
  sessions.

## What it does

- **Project the workflow skills** — copies `builtin-configs/skills/<workflow>/` →
  `.agents/skills/<workflow>/`. Their source of truth is `builtin-configs/skills/`; the projected
  `.agents/skills/<workflow>/` copy is generated — never hand-edit it.
- **Mirror** — copies `.agents/skills/` → `.claude/skills/` (source-only `*.test.ts` / `*.secrets.json`
  excluded). The only generated copy a repo-dev agent reads under `.claude/`. Runs after the projection,
  so it carries the freshly-projected workflow skills.
- **Guard the shipped root** — for every skill under `builtin-configs/skills/`: shipped
  TypeScript scripts stay self-contained (only `node:*`, `bun`/`bun:*`, relative imports — a deployed
  skill has no `node_modules`), and every `bun scripts/…` / `python scripts/…` a `SKILL.md` references
  actually exists.

## Usage

```bash
bun run skills:sync    # bun tools/skills/src/index.ts          — regenerate the .claude/skills mirror
bun run skills:check   # bun tools/skills/src/index.ts --check  — verify; exit 1 on drift / guard violation
```

The same check runs automatically under `bun test` (see `tests/repo-sync.test.ts`), so CI fails on
drift without a dedicated job.

## Scripts

```bash
bun run --filter @tale/skills typecheck
bun run --filter @tale/skills test
bun run --filter @tale/skills lint
```

The model — the two homes, how to add a skill, the runnable-script convention — is documented in
[`AGENTS.md`](../../AGENTS.md) (the skills section).
