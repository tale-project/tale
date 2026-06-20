---
name: definition-of-done
description: The universal checklist + the Ripple Map ("change X → also touch Y") that decide whether a change is actually complete. Read before declaring any change done and before opening a PR — especially to catch the cross-cutting work agents forget: translations in ALL locales, docs, migrations, accessibility, tests. A change is rarely one file.
---

# definition-of-done

The self-audit that catches the #1 agent failure: doing one part and forgetting the rest — editing
`en.json` but not `de`/`fr`, adding a Convex field with no migration, shipping UI with no docs, test,
or a11y. Run it before "done"; [`ship`](../ship/SKILL.md) turns this into the PR.

## When this applies

Before you declare any change done, and before you open a PR. The Ripple Map below is the lookup:
find the row for what you changed and do the right-hand column too.

## The rules

"Done" is not "the code compiles." Done is: every applicable box holds (or is explicitly N/A'd in
the commit body), the gate is green, and you have **observed** the change behave as intended
([`verify`](../verify/SKILL.md)). If you didn't verify it, it isn't done — say so. Each box names the
skill that owns it; that owner enforces the detail.

- **Tests** — unit for new logic (happy + one edge + one error); e2e for touched frontend; manual QA guide for user-visible behaviour. ([`testing`](../testing/SKILL.md))
- **Translations — ALL locales, same commit** — every `en.json` key exists in `de.json` and `fr.json`; `de-CH` overrides where the value differs; dead keys removed everywhere; glossary reconciled. ([`translation`](../translation/SKILL.md))
- **Docs — all base locales** — `docs/{en,de,fr}/` updated for any user-visible/config/API change. ([`docs`](../docs/SKILL.md))
- **Accessibility (WCAG 2.1 AA)** — real HTML, keyboard, visible focus, labelled controls, AA contrast, a `checkAccessibility()` block, green Storybook a11y. ([`ui-components`](../ui-components/SKILL.md))
- **Migrations** — any stored-data change → a versioned reversible migration; knowledge-DB schema → a dbmate migration verified on a fresh stack. ([`convex-migrations`](../convex-migrations/SKILL.md), [`docker`](../docker/SKILL.md))
- **Security** — OWASP pass on any boundary touched; `bun run lint:sast` clean. ([`security`](../security/SKILL.md))
- **Storybook** — a new `packages/ui` primitive ships a story covering every variant/size/state. ([`ui-components`](../ui-components/SKILL.md))
- **Loading** — `<Skeletonize>` + skeleton-aware leaves; never a hand-rolled skeleton. ([`react`](../react/SKILL.md))
- **Gate** — `bun run check` green.
- **Instructions** — if you changed a path, command, or pattern a skill or `AGENTS.md` documents, update that guide + the skill index and run the link guard. Skills are docs too. ([`write-skill`](../write-skill/SKILL.md))
- **Commit/PR** — atomic, conventional scope/type, imperative ≤72-char header. ([`git`](../git/SKILL.md))

## The Ripple Map — change X → also touch Y

| You changed…                                             | You must also…                                                                            |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A user-visible string                                    | `en/de/fr.json` (+`de-CH` if differs) · glossary · docs(3) · manual guide · e2e           |
| A translation key (add/rename/remove)                    | all base locales same commit · remove dead keys everywhere                                |
| A new interactive UI element                             | i18n label · a11y · docs · manual guide · e2e                                             |
| A new `packages/ui` primitive                            | Storybook story (all variants) · `checkAccessibility()` block · Skeletonize support       |
| A Convex field/table (rename/retype/split/drop/backfill) | the migration checklist in [`convex-migrations`](../convex-migrations/SKILL.md)           |
| A knowledge-DB schema                                    | dbmate migration under `services/db/migrations/knowledge-db/` · verify fresh `compose up` |
| Env var / CLI flag / config key / API field              | docs(3) · `.env.example` · `README{,.de,.fr}.md` · setup                                  |
| Error wording / validation / rate limit                  | docs(3) · tests · i18n                                                                    |
| A date display                                           | `useFormatDate()` — never `toLocale*`                                                     |
| A new query/mutation                                     | `queryWithRLS`/`mutationWithRLS` · validators · no `.collect()` · preload in loader       |
| A path/command/pattern a skill documents                 | update that guide + the `AGENTS.md` skill index · run `bun .claude/check-skill-links.mjs` |

## Patterns

Worked example — "add a `tags: string[]` field to customers" — shows the whole machine end-to-end:

1. **Discover** — grep `packages/ui` for an existing tag/badge primitive and [`customers/validators.ts`](../../../services/platform/convex/customers/validators.ts) for the field pattern. Reuse, don't invent.
2. **Backend** — add the optional field to schema (additive = rollback-safe) + its validator; read path uses `queryWithRLS`, no `.collect()`.
3. **Migration** — only if existing rows need backfill; a pure-additive optional field needs none. When it does, follow [`convex-migrations`](../convex-migrations/SKILL.md).
4. **Frontend** — reuse the `packages/ui` tag primitive; mutate via `useConvexMutation` (optimistic, auto-rollback); loading via `<Skeletonize>`.
5. **i18n** — labels into `en/de/fr.json` (+`de-CH` if differs); glossary if "tag" is a new term; parity + ICU tests green.
6. **a11y** — input labelled + keyboard + aria; `checkAccessibility()` block; Storybook story if a new primitive.
7. **Tests** — unit (validator/helper), e2e (add a tag → see it), manual guide updated.
8. **Docs** — `docs/{en,de,fr}` customer page updated.
9. **Verify** — Convex MCP: run `listCustomers`, confirm the field returns. Playwright MCP: add a tag, screenshot, console clean. Codify as the e2e spec.
10. **Review + ship** — `review` + DoD ticked + atomic commit `feat(platform): add customer tags`.

Skip any step and the named guard or the Ripple Map flags it — which is the whole point.
