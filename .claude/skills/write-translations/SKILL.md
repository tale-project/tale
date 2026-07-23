---
name: write-translations
description: Use this skill whenever you edit any non-English file under services/*/messages/ (e.g. de.yml, fr.yml), packages/ui/src/i18n/messages/, or any page under docs/<locale>/, add a locale, or touch a glossary term — Tale ships as one narrator written natively per language, never a word-for-word render of the English. Load it before touching any non-English string; never translate by rendering the source words. Per-locale voice doctrine lives in locales/<locale>/AGENTS.md; the loanword buckets in BUCKETS.md, the conventions template in CONVENTIONS.md, the glossary workflow in GLOSSARY_GUIDE.md.
---

# write-translations

Tale ships one calm, opinionated, second-person-informal narrator in three languages — the German page
is the same voice written natively in German, never a German rendering of the English. This file is the
cross-locale contract; the data that changes between languages (strike lists, drift patterns, gender
maps, formal-pronoun denylists) lives in the framework's per-locale test data under
[`packages/ui/src/i18n/tests/locales/`](../../../packages/ui/src/i18n/tests/locales/) and the
per-locale voice files. Read this first, then the locale file for the locale you're in.

## When this applies

Editing any non-English value under `services/*/messages/` (e.g. `de.yml`, `fr.yml`),
`packages/ui/src/i18n/messages/`, or any page under `docs/<locale>/`. Then read
[`locales/<locale>/AGENTS.md`](locales/) for that language's voice doctrine and drift catalogue. The
two reliable failure modes are bureaucratic German (passive present, sentence-final `erfolgreich`,
third-person `Sie`) and marketed French (`Découvrez`, `N'hésitez pas à`, stacked nominal phrases) —
both translate the words and lose the voice.

## Write a note first

**Invoke `write-notes`** and record your answers to this form before you translate:

- **Locale & files:** Describe the locale and files, and the source meaning you must convey (not the words).
- **Voice risk:** Describe this locale's drift mode to avoid (bureaucratic German / marketed French) and how you'll keep the native voice.
- **Must-match:** Describe the UI labels and compound terms that must stay exact, and how you confirmed them against the shipped strings.
- **Risks & unknowns:** Describe where the translation might read non-natively or drift from the source meaning.

## The rules

These four fail review. The first is reviewer-caught (voice doesn't lint cleanly); the rest are
enforced by the i18n test suite (see Patterns).

- **Same voice across locales.** Translation is a rewrite of the same narrator in another language, not
  a render of the source words — translate meaning, not words. Sentence structure, idiom, and noun
  choice all differ: the German equivalent of an English three-clause sentence is often one sentence
  with a verb-final subordinate clause; the French equivalent of a stacked English noun phrase is often
  a relative clause. A page that reads calmly in English and bureaucratically in German has a tone bug;
  fix the wording. The drift modes are language-specific — your per-locale file names yours. (reviewer-caught)

- **Informal pronoun, always.** `du` in DE and de-CH, `tu` in FR. Never `Sie`, never `vous` — formal
  pronouns put distance between Tale and the reader. The carve-out for sentence-initial DE `Sie`
  (third-person feminine) is built into the check. (enforced by `pronouns-formal`)

- **The shipped UI string is the source of truth.** Every button, menu, panel, or feature name in a
  translated page matches `services/platform/messages/<locale>.yml` exactly. When the message file and a glossary
  or doc disagree, the message file wins — the contract bends to what ships. Half-translated walkthroughs
  (`Öffne **Settings > Members**`) are the most common bug. (enforced by `terminology-ui-label`)

- **Compound terms are whole or kept whole.** `Pull Request` stays English in DE/FR; `Knowledge Base`
  translates whole to `Wissensdatenbank` / `Base de connaissances`. Half is always wrong — `Pull
Anfrage`, `Code Review-Prozess`, `Merge-Anfrage` fail. Whether a compound stays English or translates
  is a bucket decision (see [BUCKETS.md](BUCKETS.md)); whether it's a half is the rule. (enforced by
  `terminology-half-compound`)

## Patterns

**A correct translation that correctly does not translate one thing:**

> EN: _Open a pull request from your feature branch. The CI pipeline runs against the head of the
> branch; the merge into `main` is gated on green._
>
> DE: _Öffne einen Pull Request aus deinem Feature-Branch. Die CI-Pipeline läuft gegen den Kopf des
> Branches; der Merge in `main` ist erst möglich, wenn die Pipeline grün ist._
>
> `Pull Request`, `Feature-Branch`, `CI`, `Pipeline`, `Merge`, `Branch` stay English (Git-domain
> loanwords; bucket 2). `du`, never `Sie`. No `erfolgreich`, no `Wird X…`. The English-kept terms are
> the words a German-speaking developer uses without thinking — not lazy translation.

**The shipped UI read back to the reader:**

> Drift: _Open **Settings > Members** und klicke auf **Invite member**._
>
> Target: _Öffne **Einstellungen > Mitglieder** und klicke auf **Mitglied einladen**._

The reader sees the German UI; the page must echo it. Specifics: code identifiers stay English
everywhere (CLI flags `tale deploy --detach`, env vars `TALE_CONFIG_DIR`, file paths, API paths `POST
/api/v1/documents`); role names ship per locale (Owner / Inhaber / Propriétaire); parenthetical lists
translate (`(Products, Customers, Vendors)` → `(Produkte, Kunden, Lieferanten)`); navigation paths
translate segment by segment (`Settings > Members` → `Einstellungen > Mitglieder`, never
`Einstellungen > Members`).

**Three buckets, summary** (full lists + assignment in [BUCKETS.md](BUCKETS.md)):

| Bucket                | Examples                                                              | Behaviour                                                        |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Always English        | `Tale`, `Convex`, `AI`, `LLM`, `MCP`, env vars, CLI flags             | Never translates — brand, acronym, code identifier.              |
| Established loanwords | `Workflow`, `Dashboard`, `Webhook`, `Pull Request`, `Branch`, `Merge` | Stays English in DE/FR; hyphenated in DE compounds.              |
| Translate-bucket      | `Header → Kopfzeile`, `Request → Anfrage`, `Email → E-Mail`           | Must translate in DE/FR/de-CH; caught by `terminology-loanword`. |

The bucket lives on each term's entry in
[`tests/glossary/glossary.yml`](../../../packages/ui/src/i18n/tests/glossary/glossary.yml). Moving a
term between buckets is a glossary PR, not a skill PR.

**What the suite catches** — two layers run on every `bun run check`: parity + usage (sibling test
files in each consumer's `lib/i18n/` — key parity, orphan detection), and the centralized
[`@tale/ui/i18n/tests`](../../../packages/ui/src/i18n/tests/) — 26 checks (the registry's 28 entries in
[`tests/registry.ts`](../../../packages/ui/src/i18n/tests/registry.ts) minus parity + usage) over
terminology, voice, grammar, style, ICU parity, heuristics, and markdown. Most start in `report` mode
during rollout; flip to `enforce` after findings clear. **Not caught — reviewer territory:** subtler
calques past the small denylist, tone drift inside passing prose, sentence flow across clauses, ICU
plural correctness within branches, idiomatic word choice (Duden-correct ≠ native-sounding).

**Adding a locale** (e.g. Italian) — three concerns:

1. **Runtime registry** — add `it` to `SUPPORTED_LOCALES` in
   [`packages/ui/src/i18n/locales.ts`](../../../packages/ui/src/i18n/locales.ts).
2. **Test framework data** — create `packages/ui/src/i18n/tests/locales/it/` with `index.ts`,
   `style.ts`, `voice.ts`, `terminology.ts`, `grammar.ts`, `patterns.ts`, and a `planted/` folder of
   positive/negative fixtures per applicable check; register it. The startup-drift assertion in
   `locales/index.ts` keeps the runtime and test registries in sync. Optionally extend `glossary.yml`
   with `it` forms on translating terms.
3. **Doctrine** — create `locales/it/AGENTS.md` per the template in the existing locale files, and add
   its row to Companion files below.

## Before you call the translation done

**Tick every box, or N/A with a reason:**

- [ ] **Same voice as the source** — rewritten natively, not word-rendered; no bureaucratic German, no marketed French.
- [ ] **Informal pronoun throughout** — `du` (DE/de-CH), `tu` (FR); never `Sie`/`vous`.
- [ ] **Every UI label matches `services/platform/messages/<locale>.yml` exactly** — no half-translated walkthroughs.
- [ ] **Compound terms whole or kept whole** — no `Pull Anfrage` / `Merge-Anfrage`; bucket decisions honoured.
- [ ] **`en.yml` parity** — every key present, dead keys removed everywhere; `de-CH` holds only overrides.
- [ ] **The i18n suite is green** — `bun run check`.

## Companion files

- [`locales/<locale>/AGENTS.md`](locales/) — read when editing that locale's messages or docs: the voice
  doctrine and language-specific drift catalogue (`en`, `de`, `fr`, and the `de-CH` Swiss overlay of
  differences-from-DE only).
- [BUCKETS.md](BUCKETS.md) — read when deciding whether an English term translates, stays English, or
  matches the UI verbatim; holds the full per-bucket lists, the assignment workflow, and the
  half-compound denylists.
- [CONVENTIONS.md](CONVENTIONS.md) — read when handling quotes, apostrophes, dates, numbers, currency,
  percent, NBSP, dashes, or ß: the 14-row conventions template every locale fills.
- [GLOSSARY_GUIDE.md](GLOSSARY_GUIDE.md) — read when adding a glossary term, choosing its category, or
  using `_lintExclude` to defer a UI-vs-bucket mismatch; also documents the role table and the audit
  script.
