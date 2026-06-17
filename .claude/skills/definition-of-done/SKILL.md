---
name: definition-of-done
description: The universal checklist + the Ripple Map ("change X → also touch Y") that decide whether a change is actually complete. Read before declaring any change done and before opening a PR — especially to catch the cross-cutting work agents forget: translations in ALL locales, docs, migrations, accessibility, tests. A change is rarely one file.
---

# definition-of-done

The #1 failure mode for agent changes is doing one part and forgetting the rest — updating `en.json`
but not `de`/`fr`, adding a Convex field with no migration, shipping a UI change with no docs, test,
or a11y. This skill is the self-audit that prevents it. Run it before "done"; the
[`ship`](../ship/SKILL.md) skill turns it into the PR.

## Definition of Done

"Done" is not "the code compiles." Done is: every applicable box holds (or is explicitly N/A'd in
the commit body), the gate is green, and you have **observed** the change behave as intended
([`verify`](../verify/SKILL.md)). If you didn't verify it, it isn't done — say so.

- **Tests** — unit for new logic (happy + one edge + one error); e2e for touched frontend; manual QA guide for user-visible behaviour. ([`testing`](../testing/SKILL.md))
- **Translations — ALL locales, same commit** — every key in `en.json` exists in `de.json` and `fr.json`; `de-CH` overrides where the value differs; dead keys removed everywhere; glossary reconciled. ([`translation`](../translation/SKILL.md))
- **Docs — all base locales** — `docs/{en,de,fr}/` updated for any user-visible/config/API change, with a real opening + closing. ([`docs`](../docs/SKILL.md))
- **Accessibility (WCAG 2.1 AA)** — real HTML, keyboard, visible focus, labelled controls, AA contrast, `checkAccessibility()` block, green Storybook a11y. ([`ui-components`](../ui-components/SKILL.md))
- **Migrations** — Convex data-model change → versioned reversible migration + `migration.test.ts` + registry + `migrations:check`; knowledge-DB schema → dbmate migration verified on a fresh stack. ([`convex-migrations`](../convex-migrations/SKILL.md), [`docker`](../docker/SKILL.md))
- **Security** — OWASP pass on any boundary touched; `lint:sast` clean. ([`security`](../security/SKILL.md))
- **Storybook** — new `components/ui/` primitive ships a story covering every variant/size/state.
- **Loading** — `<Skeletonize>` + skeleton-aware leaves; never a hand-rolled skeleton.
- **Gate** — `bun run check` green.
- **Instructions** — if you changed a path, command, or pattern a skill or `AGENTS.md` describes, update that guide + the skill index and run the link guard. Skills are docs too. ([`write-skill`](../write-skill/SKILL.md))
- **Commit/PR** — atomic, conventional scope/type, imperative ≤72-char header. ([`git`](../git/SKILL.md))

## The Ripple Map — change X → also touch Y

| You changed…                                | You must also…                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A user-visible string                       | `en/de/fr.json` (+`de-CH` if differs) · glossary · docs(3) · manual guide · e2e           |
| A translation key (add/rename/remove)       | all base locales same commit · remove dead keys everywhere                                |
| A new interactive UI element                | i18n label · a11y · docs · manual guide · e2e                                             |
| A new `components/ui/` primitive            | Storybook story (all variants) · a11y block · Skeletonize support                         |
| A Convex field/table                        | migration + up/down + `migration.test.ts` + registry + `migrations:check`                 |
| A knowledge-DB schema                       | dbmate migration under `migrations/knowledge-db/<schema>/` · verify fresh `compose up`    |
| Env var / CLI flag / config key / API field | docs(3) · `.env.example` · `README{,.de,.fr}.md` · setup                                  |
| Error wording / validation / rate limit     | docs(3) · tests · i18n                                                                    |
| A date display                              | `useFormatDate()` — never `toLocale*`                                                     |
| A new query/mutation                        | `queryWithRLS`/`mutationWithRLS` · validators · no `.collect()` · preload in loader       |
| A path/command/pattern a skill documents    | update that guide + the `AGENTS.md` skill index · run `bun .claude/check-skill-links.mjs` |

## Worked example — "add a `tags: string[]` field to customers"

Shows the whole machine end-to-end:

1. **Discover** — grep `packages/ui` for an existing tag/badge primitive and `customers/validators.ts` for the field pattern. Reuse, don't invent.
2. **Backend** — add the optional field to schema (additive = rollback-safe) + its validator; read path uses `queryWithRLS`, no `.collect()`.
3. **Migration** — only if existing rows need backfill: versioned `up`/`down` + `migration.test.ts` + registry + `migrations:check`. (Pure-additive optional field → none.)
4. **Frontend** — reuse the `packages/ui` tag primitive; mutate via `useConvexMutation` (optimistic, auto-rollback); loading via `<Skeletonize>`.
5. **i18n** — labels into `en/de/fr.json` (+`de-CH` if differs); glossary if "tag" is a new term; parity + ICU tests green.
6. **a11y** — input labelled + keyboard + aria; `checkAccessibility()` block; Storybook story if a new primitive.
7. **Tests** — unit (validator/helper), e2e (add a tag → see it), manual guide updated.
8. **Docs** — `docs/{en,de,fr}` customer page updated.
9. **Verify** — Convex MCP: run `listCustomers`, confirm the field returns. Playwright MCP: add a tag in the app, screenshot, console clean. Codify as the e2e spec.
10. **Review + ship** — `review` + DoD ticked + atomic commit `feat(platform): add customer tags`.

Skip any step and the named guard or the Ripple Map flags it — which is the whole point.
