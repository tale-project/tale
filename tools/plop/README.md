# @tale/plop

Plop generators and templates for scaffolding new Tale services and packages.

The root [`plopfile.ts`](../../plopfile.ts) wires these generators into the `bun run gen` workflow.

## Usage

Run from the repo root:

```bash
bun run gen                       # interactive prompt
bun run gen:react-service
bun run gen:react-package
bun run gen:typescript-package
bun run gen:python-service
bun run gen:python-package
bun run gen:docker-service
```

## Layout

- `generators/` — generator definitions (one per scaffold type)
- `templates/` — Handlebars (`.hbs`) and static templates rendered by the generators
- `helpers/` — shared Handlebars helpers registered with Plop

## Workspace scripts

```bash
bun run --filter @tale/plop lint
bun run --filter @tale/plop typecheck
```
