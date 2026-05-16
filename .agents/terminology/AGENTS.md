---
name: terminology
description: The cross-locale terminology contract for the Tale platform UI, marketing site, and docs site — covering English source forms AND every translation, with per-language tone rules, the loanword policy, and the canonical UI label tables. Use whenever writing or editing any user-facing string in `services/platform/messages/*.json`, `services/web/messages/*.json`, `services/docs/messages/*.json`, or pages under `docs/`.
---

# Tale terminology — the contract

This skill is the authoritative source for how every product term renders **in every locale, including English**. English is not exempt — it has its own spelling, capitalisation, and style rules. Translations derive from the English form; each locale then layers its own conventions on top.

The contract is split across **three surfaces**:

1. **Doctrine + illustrative tables** — `TERMINOLOGY*.md` in this directory. Voice rules, anti-pattern descriptions, drift→target pairs, marketing-softener strike lists, toast conventions, error-message patterns, per-locale style rules, `de-CH` overrides. Read this when you want to understand a rule.
2. **Term lookups** — [`GLOSSARY.json`](GLOSSARY.json), a single flat `terms[]` array with entries of shape `{ key, category, en, de?, fr?, de_ch?, _lintExclude?, _note? }`. Filter by `category` to find features, knowledgeEntities, technicalVocab, actionVerbs, deploymentVocab, role, brand, acronym, codeIdentifier, loanword, gitDomain, translateBucket, or abbreviation.
3. **Test inputs** — TypeScript modules under [`services/docs/tests/data/`](../../services/docs/tests/data/). Closed lists the tests consume directly: `formal-pronouns.ts` and `noun-genders-de.ts`. Reachable by name from each test file, type-checked, no JSON round-trip.

When the doctrine and the glossary disagree, the **glossary wins for words**; the **doctrine wins for rules**. When the glossary and the shipped UI disagree, the **UI wins** — update the glossary in the same PR.

Three surfaces follow these rules:

1. **Platform UI** — `services/platform/messages/*.json`. Labels, buttons, status messages, errors.
2. **Marketing site** — `services/web/messages/*.json`. Long-form marketing copy, FAQs, CTAs.
3. **Docs site** — `docs/**` page bodies plus `services/docs/messages/*.json` chrome strings.

When the shipped UI and the glossary disagree, the UI wins. Update the glossary to match, then propagate to docs and marketing.

## Files in this skill

| File                                                           | What it owns                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`TERMINOLOGY.md`](TERMINOLOGY.md)                             | Cross-locale doctrine. Voice rules, the three-bucket loanword policy, the no-half-translation rule, the error-message pattern table, plurals, placeholders, dates / numbers / quotes. Read first.                 |
| [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md)                       | English doctrine. Voice rules, EN anti-pattern catalogue + drift→target tables, EN marketing-softener strike list, EN toast/error patterns, EN style + date/number rules.                                         |
| [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md)                       | German doctrine. DE voice rules, the bureaucracy-drift catalogue (descriptions + 10 drift→target tables), DE marketing-softener strike list, DE toast pattern, DE style + ß/ss policy.                            |
| [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md)                 | Swiss German doctrine + override tables. ß → ss spelling table, lexical-override table, Swiss number formatting, currency, legal references.                                                                      |
| [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md)                       | French doctrine. FR voice rules, the marketing-drift catalogue (descriptions + 8 drift→target tables), FR marketing-softener strike list, FR toast pattern, FR style + NBSP placement.                            |
| [`GLOSSARY.json`](GLOSSARY.json)                               | Term lookups. The flat `terms[]` array with entries `{ key, category, en, de?, fr?, de_ch?, _lintExclude?, _note? }` and category metadata. No drift→target pairs, no anti-pattern catalogues — those live in MD. |
| [`services/docs/tests/data/`](../../services/docs/tests/data/) | Test-data lists as TypeScript modules: `formal-pronouns.ts`, `noun-genders-de.ts`. Imported by the docs tests directly; no JSON parsing.                                                                          |

Add a `TERMINOLOGY_<LOCALE>.md` for any new regional variant. Term overrides for the new locale go into [`GLOSSARY.json`](GLOSSARY.json) `terms[]` as additional optional locale fields on existing entries.

## When to use this skill

Always when you touch:

- **Any English string** in `en.json` files, English docs pages, or marketing copy — check the EN doctrine and `terms[]` (filter by `category`) in [`GLOSSARY.json`](GLOSSARY.json) for the canonical form.
- **Any translated string** in DE/FR/`de-CH` files — check the per-locale doctrine and the `de`/`fr`/`de_ch` fields on the relevant glossary term. Quote UI labels verbatim from the locale JSON; respect the loanword policy.
- **Docs pages under `docs/[locale]/**`\*\* — same as above. The docs tests enforce a subset of these rules automatically.
- **A new product term being introduced to the UI** — add a new entry to `terms[]` in [`GLOSSARY.json`](GLOSSARY.json) in the same PR. The doctrine doesn't change for each new word.
- **A new locale or regional variant** — create `TERMINOLOGY_<LOCALE>.md` (doctrine) and add an optional locale field on each affected entry in [`GLOSSARY.json`](GLOSSARY.json) `terms[]`.

## The contract in five lines

1. **One voice across every locale** — calm, opinionated, second-person informal (`du`/`tu`/`you`). The narrator does not change between languages.
2. **UI wins over the glossary** — if the shipped UI string and [`GLOSSARY.json`](GLOSSARY.json) disagree, update the glossary.
3. **Three loanword buckets** govern every English noun in DE/FR prose — `brand`/`acronym`/`codeIdentifier` (always English), `loanword`/`gitDomain` (established loanwords), `translateBucket` (must translate). Categories are stored on each entry in `terms[]`.
4. **No formal pronouns** — never `Sie`, never `vous`, never their inflections.
5. **No drift modes** — German must not drift into passive bureaucracy; French must not drift into marketing softening; neither locale half-translates compound terms.

## Before-commit scan

Run this scan on every translated string and every docs page:

1. **Voice.** Reads calm and opinionated, with the _why_ present? Not bureaucratic in German, not marketing-soft in French? No `we`, no marketing softeners?
2. **Pronoun.** No `Sie` / `Ihnen` / `Ihre` in DE. No `vous` / `votre` / `vos` in FR.
3. **Loanwords.** Every English noun in DE/FR prose has `category` of `brand`, `acronym`, `codeIdentifier`, `loanword`, or `gitDomain` — or it's a bug. `translateBucket` entries must always translate.
4. **No half-translated compounds.** Read each multi-word technical term aloud. If the language switches mid-word, the compound is broken.
5. **UI labels.** Every name of a button, menu, panel, or feature matches the string in `services/platform/messages/<locale>.json` verbatim.
6. **Per-locale anti-patterns.**
   - **DE**: no `Wird X…` passive present, no sentence-final `erfolgreich`, no `Damit` sentence opener, no compound stacks longer than three roots, no gender disagreement on the closed noun set (`noun-genders-de.ts`).
   - **FR**: no marketing softeners (`Découvrez`, `N'hésitez pas à`, `tout simplement`, `il vous suffit de`), respect non-breaking-space rules before `:;!?%`.
7. **Numbers, dates, quotation marks.** Locale conventions applied in prose. Canonical formats kept inside code fences and frontmatter.

The docs test suite ([`services/docs/tests/`](../../services/docs/tests/)) automates checks 2 and 3 (and a subset of check 5). The other checks are on you.

## How the test scaffolding sees these rules

The tests in [`services/docs/tests/`](../../services/docs/tests/) consume two surfaces: [`GLOSSARY.json`](GLOSSARY.json) for term mappings, and TypeScript modules under [`services/docs/tests/data/`](../../services/docs/tests/data/) for closed lists that aren't term-shaped.

- **[`terminology-pronouns.test.ts`](../../services/docs/tests/terminology-pronouns.test.ts)** — hard-fail. Rejects the formal-pronoun denylist (`Sie`/`Ihnen`/…/`vous`/`votre`/…) in DE/FR/de-CH prose. List lives in [`data/formal-pronouns.ts`](../../services/docs/tests/data/formal-pronouns.ts).
- **[`terminology-ui.test.ts`](../../services/docs/tests/terminology-ui.test.ts)** — hard-fail. For every term whose locale form differs from `en` and whose `category` is in the enforced set (`feature`, `role`, `knowledgeEntity`, `translateBucket`), the test rejects the English form appearing in the page body. Honours the `_lintExclude` field.
- **[`terminology-loanword.test.ts`](../../services/docs/tests/terminology-loanword.test.ts)** — hard-fail. Narrower variant of the above, scoped to `category === "translateBucket"` for a sharper error message.
- **[`terminology-compounds.test.ts`](../../services/docs/tests/terminology-compounds.test.ts)** — hard-fail. Rejects half-translated compounds (`Pull Anfrage`, `Code Review-Prozess`, `Branch-Zweig`, …). List lives in [`data/half-compounds.ts`](../../services/docs/tests/data/half-compounds.ts).
- **[`voice-en.test.ts`](../../services/docs/tests/voice-en.test.ts) / [`voice-de.test.ts`](../../services/docs/tests/voice-de.test.ts) / [`voice-fr.test.ts`](../../services/docs/tests/voice-fr.test.ts)** — hard-fail. Per-locale marketing-softener strike lists and DE bureaucracy drift rules. Data in `data/voice-strike-{en,de,fr}.ts` and `data/voice-bureaucracy-de.ts`.
- **[`grammar-de.test.ts`](../../services/docs/tests/grammar-de.test.ts)** — hard-fail. Imports the closed noun-gender map from [`data/noun-genders-de.ts`](../../services/docs/tests/data/noun-genders-de.ts) and flags indefinite-article disagreement (`einen <fem-noun>`, `eine <masc-noun>`, etc.) with preposition-aware precision tightening.
- **All checks mask code fences, inline-code spans, and link URLs** before scanning, so a UI-bucket noun inside ` ```http ` blocks or inside `/api-reference#headers` URLs is not flagged.
