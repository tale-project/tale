---
name: translation
description: How to translate Tale's UI, marketing copy, and docs across locales. Read before editing any non-English file under services/*/messages/, packages/ui/src/i18n/messages/, or any page under docs/<locale>/. Per-locale specifics live in locales/<locale>/AGENTS.md alongside this file. The loanword buckets live in BUCKETS.md, the conventions table template in CONVENTIONS.md, and the glossary workflow in GLOSSARY_GUIDE.md.
---

# translation

Tale ships one narrator in three languages. The German page is not a German rendering of the English page — it is the same calm, opinionated voice, written natively in German. The two reliable failure modes are bureaucratic German (passive present, sentence-final `erfolgreich`, third-person `Sie`) and marketed French (`Découvrez`, `N'hésitez pas à`, stacked nominal phrases). Both translate the words and lose the voice. Fix the voice, then the wording follows.

This file is the cross-locale contract. It lists the four rules that fail review, names the translator's stance, summarises the three-bucket loanword policy, and points to the per-language files. The contents that change between languages — strike lists, drift patterns, gender maps, formal-pronoun denylists — live in the framework's per-locale data under [`packages/ui/src/i18n/tests/locales/`](../../../packages/ui/src/i18n/tests/locales/) and are caught by the test suite. Read this file first, then the locale file for the locale you are working in.

## What fails review

**Rule 1 — Same voice across locales.** The calm, opinionated, second-person-informal narrator survives translation. Translation is a rewrite of the same voice in another language, not a rendering of the source words. A page that reads calmly in English and bureaucratically in German has a tone bug; fix the wording. The drift modes are language-specific — the per-locale file names yours.

**Rule 2 — Informal pronoun, always.** `du` in DE and de-CH, `tu` in FR. Never `Sie`, never `vous`, never their inflections. The formal-pronoun denylist in the test data ([`packages/ui/src/i18n/tests/locales/<locale>/patterns.ts`](../../../packages/ui/src/i18n/tests/locales/)) catches the obvious slips; the carve-out for sentence-initial DE `Sie` (third-person feminine) is built into the check.

**Rule 3 — The shipped UI string is the source of truth.** Every button, menu, panel, or feature name in a translated page matches `services/platform/messages/<locale>.json` exactly. When the JSON and a glossary or doc disagree, the JSON wins — the contract bends to what ships. Half-translated sentences (`Öffne **Settings > Members**`) fail.

**Rule 4 — Compound terms are whole or kept whole.** `Pull Request` stays English in DE and FR; `Knowledge Base` translates whole to `Wissensdatenbank` / `Base de connaissances`. Half is always wrong — `Pull Anfrage`, `Code Review-Prozess`, `Merge-Anfrage` fail. Whether a compound stays English or translates is a bucket decision (see [BUCKETS.md](BUCKETS.md)); whether it is a half is the rule.

## The translator's stance

Translate meaning, not words. Sentence structure, idiom, and noun choice all differ across languages. A mechanical word-for-word render produces sentences native readers reject even when every individual word is correct. The German equivalent of an English three-clause sentence is often one longer sentence with a verb-final subordinate clause; the French equivalent of a stacked English noun phrase is often a relative clause. Write the _natural_ target-language sentence, not the calque.

> **A correct translation that correctly does not translate one thing.**
>
> EN: _Open a pull request from your feature branch. The CI pipeline runs against the head of the branch; the merge into `main` is gated on green._
>
> DE: _Öffne einen Pull Request aus deinem Feature-Branch. Die CI-Pipeline läuft gegen den Kopf des Branches; der Merge in `main` ist erst möglich, wenn die Pipeline grün ist._
>
> `Pull Request`, `Feature-Branch`, `CI`, `Pipeline`, `Merge`, `Branch` stay English (Git-domain loanwords; bucket 2a). `du`, never `Sie`. No `erfolgreich`, no `Wird X…`. The English-kept terms are not lazy translation — they are the words a German-speaking developer uses without thinking.

## Three buckets, summary

Every English noun that appears in a non-English value or docs page falls into one of three buckets. The full per-bucket lists, the assignment rules, and the test enforcement live in [BUCKETS.md](BUCKETS.md).

| Bucket                | Examples                                                                                  | Behaviour                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Always English        | `Tale`, `Convex`, `AI`, `LLM`, `MCP`, env vars, CLI flags                                 | Never translates. Brand, acronym, code identifier.                           |
| Established loanwords | `Workflow`, `Dashboard`, `Webhook`, `Pull Request`, `Branch`, `Merge`                     | Stays English in DE/FR. Hyphenated in DE compounds (`Workflow-Schritt`).     |
| Translate-bucket      | `Header → Kopfzeile`, `Request → Anfrage`, `Email → E-Mail`, `Help Center → Hilfe-Center` | Must translate in DE/FR/de-CH. Enforced by the `terminology-loanword` check. |

The bucket assignment for every term lives on its entry in [`packages/ui/src/i18n/tests/glossary/glossary.json`](../../../packages/ui/src/i18n/tests/glossary/glossary.json). Moving a term between buckets is a glossary PR, not a skill PR. See [GLOSSARY_GUIDE.md](GLOSSARY_GUIDE.md).

## The shipped UI is the source

Every user-facing term a doc page names matches the string the UI actually displays in that locale, verbatim. Source of truth: `services/platform/messages/<locale>.json`. Mixed forms — half English, half translated in the same sentence — are the most common bug.

> **Drift.** _Open **Settings > Members** und klicke auf **Invite member**._
>
> **Target.** _Öffne **Einstellungen > Mitglieder** und klicke auf **Mitglied einladen**._
>
> The reader sees the German UI; the page must read the German UI back to them. Half-translated walkthroughs fail Rule 3.

Specific rules:

- When the UI and the glossary disagree, the UI wins — update the glossary in the same PR.
- Code identifiers stay English everywhere (CLI flags `tale deploy --detach`, env vars `TALE_CONFIG_DIR`, file paths `docker-compose.yml`, API paths `POST /api/v1/documents`).
- Role names ship per locale — Owner / Inhaber / Propriétaire. The per-locale file lists the full 6-row table.
- Parenthetical lists translate too — `(Products, Customers, Vendors)` becomes `(Produkte, Kunden, Lieferanten)` in DE.
- Navigation paths translate segment by segment — `Settings > Members` becomes `Einstellungen > Mitglieder`, never `Einstellungen > Members`.

## Per-locale files

Each locale has a folder under [`locales/`](locales/). Read the one for the locale you are working in:

- [`locales/en/AGENTS.md`](locales/en/AGENTS.md) — English voice doctrine.
- [`locales/de/AGENTS.md`](locales/de/AGENTS.md) — German voice doctrine. Names the bureaucracy-drift modes; required reading when editing `de.json` or any `docs/de/` page.
- [`locales/fr/AGENTS.md`](locales/fr/AGENTS.md) — French voice doctrine. Names the marketing-drift modes; required reading when editing `fr.json` or any `docs/fr/` page.
- [`locales/de-CH/AGENTS.md`](locales/de-CH/AGENTS.md) — Swiss German overlay. Only the differences from DE — spelling (no `ß`), quotes, currency, numbers.

## Adding a locale

The framework is locale-extensible by design. Adding a new locale (e.g. Italian) is three concerns:

1. **Runtime registry.** Add `it` to `SUPPORTED_LOCALES` in [`packages/ui/src/i18n/locales.ts`](../../../packages/ui/src/i18n/locales.ts).
2. **Test framework data.** Create [`packages/ui/src/i18n/tests/locales/it/`](../../../packages/ui/src/i18n/tests/locales/) with `index.ts`, `style.ts`, `voice.ts`, `terminology.ts`, `grammar.ts`, `patterns.ts`, and a `planted/` folder with positive/negative fixtures per applicable check. Add `LOCALE_IT` to the locale registry's array. The startup-drift assertion in `locales/index.ts` keeps the runtime and test registries from getting out of sync.
3. **Doctrine.** Create `.claude/skills/translation/locales/it/AGENTS.md` per the template in the existing locale files. Add a one-line catalogue entry to this file (the "Per-locale files" section above).

Optional: extend [`packages/ui/src/i18n/tests/glossary/glossary.json`](../../../packages/ui/src/i18n/tests/glossary/glossary.json) with `it` forms on every term that translates (typically the 11+ translate-bucket entries).

No consumer service or plop template needs editing.

## What the test suite catches

Two layers run on every `bun run check`:

- **Parity + usage** — sibling test files in each consumer's `lib/i18n/`. Locale key parity and orphan-key detection. Enforced.
- **Centralized i18n** — [`@tale/ui/i18n/tests`](../../../packages/ui/src/i18n/tests/). 26 checks (the registry's 28 entries minus the `parity` + `usage` layer above) covering terminology (loanword, half-compound, UI-label), voice (per-locale strikes + drift), grammar (DE articles), style (quotes, apostrophes, dashes, NBSP, numbers, dates, currency, ß), ICU parity (brace-balance + placeholders + plural rules), heuristics (glossary-coverage, placeholder-density), markdown (anchor-parity, link-target, status-chatter, prose-exclamation). The full list is [`tests/registry.ts`](../../../packages/ui/src/i18n/tests/registry.ts). Most start in `report` mode during the rollout; the end-of-run summary surfaces findings without failing the build. Flip a check to `enforce` after its findings are cleared.

What the suite does NOT catch — review territory:

- Calques beyond the small denylist (`Vertrauenshaltung`, `Nutzerreise`); subtler calques pass lint.
- Tone drift inside passing prose (bureaucratic German that has no `Wird` opener still reads bureaucratic; reviewer's call).
- Sentence flow across clauses; ICU plural correctness within plural branches; locale-specific quoted-attribution conventions.
- Word choice in idiomatic phrases (Duden-correct doesn't mean native-sounding).

## Where to read what

| Concern                                                                                                        | File                                               |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Cross-locale rules and stance                                                                                  | this file                                          |
| Three-bucket loanword policy, the full per-bucket lists, bucket-assignment workflow                            | [BUCKETS.md](BUCKETS.md)                           |
| The conventions table template (quotes, apostrophes, dates, numbers, currency, NBSP, ß) that each locale fills | [CONVENTIONS.md](CONVENTIONS.md)                   |
| Glossary workflow — adding a term, choosing a category, `_lintExclude` semantics                               | [GLOSSARY_GUIDE.md](GLOSSARY_GUIDE.md)             |
| English voice                                                                                                  | [locales/en/AGENTS.md](locales/en/AGENTS.md)       |
| German voice + drift catalogue                                                                                 | [locales/de/AGENTS.md](locales/de/AGENTS.md)       |
| French voice + drift catalogue                                                                                 | [locales/fr/AGENTS.md](locales/fr/AGENTS.md)       |
| Swiss German overlay                                                                                           | [locales/de-CH/AGENTS.md](locales/de-CH/AGENTS.md) |
