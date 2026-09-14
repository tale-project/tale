# @tale/ui

Shared React components, styling, and interface utilities for Tale's platform, website, and docs.
This is a source-only workspace: consumers import explicit `@tale/ui/<subpath>` exports, and their
application build compiles the source.

## Find an existing component

Read the [design contract](../../design/) before changing a screen. Browse [`src/`](src/) and the
package's `exports` map before adding a component; use the existing interaction and styling patterns.

```bash
bun run --filter @tale/ui storybook
```

The package supplies the Tailwind preset at `@tale/ui/tailwind-preset` and the base stylesheet at
`@tale/ui/globals.css`. Application-specific behavior belongs in the consuming service. A shared
component should expose the state and events its consumers need without importing from a service.

## Write documentation content

The [Markdown component registry](src/markdown/components/registry.tsx) defines the components the
docs renderer supports. Follow the [docs contract](../../docs/AGENTS.md) for examples, content,
screenshots, and navigation; follow the [translation skill](../../.agents/skills/write-translations/SKILL.md)
for labels and locale changes.

Shared interface messages live under `src/i18n/messages/`. Keep English, German, French, and relevant
Swiss German overrides aligned. The locale checks cover structural and voice rules, while review
still needs to verify meaning and natural language.

## Validate a change

From the repository root:

```bash
bun run --filter @tale/ui typecheck
bun run --filter @tale/ui lint
bun run --filter @tale/ui test
```

Use the relevant component stories and tests, then verify the consuming application's real behavior.
For interactive controls, check keyboard access, labels, focus, disabled states, and error recovery.
See the [repo contract](../../.agents/repo.md) for the full change requirements.
