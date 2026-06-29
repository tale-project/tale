# @tale/skills

Mirror sync + portability guard for the Tale monorepo's skills.

Skills live in three independent source roots, by audience:

- **`.agents/skills/`** — repo-dev coding guides (docs). The source every coding agent reads: Cursor,
  Codex, and Copilot open it directly; Claude Code reads the generated **`.claude/skills/`** mirror,
  which this tool regenerates.
- **`builtin-configs/skills/`** — product skills (`docx`, `pptx`, …) shipped to org agents: embedded
  in the CLI binary, seeded per-org at chat time. Hand-maintained.
- **`skills/`** — self-contained Bun workspace skills (`visual-aspect-analyzer`) baked into the
  `services/sandbox-runtime` image.

## What it does

- **Mirror** — copies `.agents/skills/` → `.claude/skills/` (source-only `*.test.ts` / `*.secrets.json`
  excluded). The only generated copy of a skill.
- **Guard the shipped roots** — for every skill under `builtin-configs/skills/` and `skills/`: shipped
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

The model — the three homes, how to add a skill, the runnable-script convention — is documented in
[`AGENTS.md`](../../AGENTS.md) (the skills section).
