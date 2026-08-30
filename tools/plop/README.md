# @tale/plop

Plop generators and templates for scaffolding new Tale workspaces — packages,
services, tools, and skills. **Always scaffold a new workspace from these
generators** instead of hand-rolling or copy-pasting one, so every new part
inherits the repo's conventions (the shared `tsconfig.base.json`, lint config,
i18n bundle, tests, and Docker setup) automatically.

The root [`plopfile.ts`](../../plopfile.ts) wires these generators into the
`bun run gen` workflow.

## Usage

Run from the repo root:

```bash
bun run gen            # interactive: pick a generator, then a variant
bun run gen:package    # packages/<name> — kind: react | typescript
bun run gen:service    # services/<name> — kind: react | docker
bun run gen:tool       # tools/<name>    — kind: typescript | shell
bun run gen:skill      # .agents/skills/<name> or builtin-configs/skills/<name> — docs (SKILL.md + README)
bun run gen:migration  # services/platform/backend/db/migrations/<NNNN>_<slug>.sql
bun run gen:episode    # services/platform/tests/docs-videos/episodes/<id> — spec + choreography skeleton
```

Each generator prompts for a **kind** (the skill generator for a **category**)
and scaffolds from the matching `templates/<category>/<kind>/` directory.

## Layout

- `generators/` — one generator per category (`package`, `service`, `tool`, `skill`,
  `migration`, `video-episode`), most selecting a variant via a `kind` prompt
- `templates/<category>/<kind>/` — Handlebars (`.hbs`) and static templates
  rendered by the generators
- `helpers/` — shared Handlebars helpers registered with Plop

## Workspace scripts

```bash
bun run --filter @tale/plop lint
bun run --filter @tale/plop typecheck
```
