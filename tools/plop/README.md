# @tale/plop

Plop generators and templates for scaffolding new Tale workspaces — packages,
services, tools, and skills — and the manual-test layer of an existing unit.
**Always scaffold a new workspace from these generators** instead of
hand-rolling or copy-pasting one, so every new part inherits the repo's
conventions (the shared `tsconfig.base.json`, lint config, i18n bundle, tests,
and Docker setup) automatically.

[`plopfile.ts`](plopfile.ts) wires these generators into the `bun run gen`
workflow.

## Usage

Run from the repo root:

```bash
bun run gen            # interactive: pick a generator, then a variant
bun run gen:package    # packages/<name> — kind: react | typescript
bun run gen:service    # services/<name> — kind: react | docker
bun run gen:manual     # <unit>/tests/manual — the manual-test layer of an existing unit that has none
bun run gen:tool       # tools/<name>    — kind: typescript | shell
bun run gen:skill      # .agents/skills/<name> or configs/platform/custom/skills/<name> — docs (SKILL.md + README)
bun run gen:migration  # services/platform/backend/db/migrations/<NNNN>_<slug>.sql — kind: sql | ts (a data migration)
bun run gen:episode    # services/platform/tests/docs-videos/episodes/<id> — spec + choreography skeleton
```

Each generator prompts for a **kind** (the skill generator for a **category**)
and scaffolds from the matching `templates/<category>/<kind>/` directory.

`gen:manual` renders the same layer a new service is born with (the shared
files under `templates/service/manual/`, one list in `generators/manual.ts`)
into an existing workspace, named by its path from the repo root
(`bun run gen:manual <unit> none`: the path, then the dev port of a unit
driven in a browser, or `none`). It refuses a unit that has no `package.json`
or already carries a `tests/manual/`. The first suite is the unit's own: the
generator ends with the steps that make the layer pass `bun run lint:manual`.

## Layout

- `generators/` — one generator per category (`package`, `service`, `manual`,
  `tool`, `skill`, `migration`, `video-episode`), most selecting a variant via a
  `kind` prompt
- `templates/<category>/<kind>/` — Handlebars (`.hbs`) and static templates
  rendered by the generators
- `helpers/` — shared Handlebars helpers registered with Plop
- `tests/` — `templates.test.ts` asserts every templateFile a generator
  references exists on disk and that every `gen:<x>` script reaches a
  registered generator; `manual.test.ts` runs the manual layer a service is
  scaffolded with, and the one `gen:manual` adds to an existing unit, through
  the real `bun run lint:manual`, so a new service is never born red and the
  `manual` generator's closing steps name all that is left

## Workspace scripts

```bash
bun run --filter @tale/plop lint
bun run --filter @tale/plop typecheck
bun run --filter @tale/plop test
```
