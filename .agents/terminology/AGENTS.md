---
name: terminology
description: The cross-locale terminology contract for the Tale platform UI, marketing site, and docs site — covering English source forms AND every translation, with per-language tone rules, the loanword policy, and the canonical UI label tables. Use whenever writing or editing any user-facing string in `services/platform/messages/*.json`, `services/web/messages/*.json`, `services/docs/messages/*.json`, or pages under `docs/`.
---

# Tale terminology — the contract

This skill is the authoritative source for how every product term renders **in every locale, including English**. English is not exempt — it has its own spelling, capitalisation, and style rules. Translations derive from the English form; each locale then layers its own conventions on top.

The contract is split between **doctrine** and **data**:

1. **Doctrine ring (Markdown)** — voice rules, anti-pattern descriptions, principles, lifecycle rules. One cross-locale file plus one per locale.
2. **Data ring (JSON)** — every concrete word, every translation pair, every drift→target example, every closed list. One file: [`GLOSSARY.json`](GLOSSARY.json).

When the doctrine and the glossary disagree, the **glossary wins for words**; the **doctrine wins for rules**. The markdown is human-readable rationale; the JSON is the machine surface the tests consume.

Three surfaces follow these rules:

1. **Platform UI** — `services/platform/messages/*.json`. Labels, buttons, status messages, errors.
2. **Marketing site** — `services/web/messages/*.json`. Long-form marketing copy, FAQs, CTAs.
3. **Docs site** — `docs/**` page bodies plus `services/docs/messages/*.json` chrome strings.

When the shipped UI and the glossary disagree, the UI wins. Update the glossary to match, then propagate to docs and marketing.

## Files in this skill

| File                                           | What it owns                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`TERMINOLOGY.md`](TERMINOLOGY.md)             | Cross-locale doctrine. Voice rules, the three-bucket loanword policy, the no-half-translation rule, error-message style, plurals, placeholders. Read first.            |
| [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md)       | English-specific doctrine. Voice rules, EN anti-pattern descriptions, EN style rules. **No word tables — they live in `GLOSSARY.json`.**                               |
| [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md)       | German doctrine. Voice rules, the bureaucracy-drift anti-pattern catalogue (descriptions only), DE style rules including the `ß` policy.                               |
| [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md) | Swiss German doctrine. Override-only rule, `ß → ss` policy, Swiss number formatting and currency rules.                                                                |
| [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md)       | French doctrine. Voice rules, the marketing-drift anti-pattern catalogue (descriptions only), FR style rules including non-breaking-space placement.                   |
| [`GLOSSARY.json`](GLOSSARY.json)               | **The only place concrete words live.** Every translation table, every loanword bucket, every drift→target example, every closed list, every style-conventions matrix. |

Add a `TERMINOLOGY_<LOCALE>.md` for any new regional variant — and a corresponding override block in [`GLOSSARY.json`](GLOSSARY.json). Variants list only what differs from the base; the base applies to everything else.

## When to use this skill

Always when you touch:

- **Any English string** in `en.json` files, English docs pages, or marketing copy — check the EN doctrine and `productVocabulary.*` in [`GLOSSARY.json`](GLOSSARY.json) for the canonical form.
- **Any translated string** in DE/FR/`de-CH` files — check the per-locale doctrine and the relevant glossary sections. Quote UI labels verbatim from the locale JSON; respect the loanword policy.
- **Docs pages under `docs/[locale]/**`\*\* — same as above. The docs tests enforce a subset of these rules automatically.
- **A new product term being introduced to the UI** — add the canonical entry to `productVocabulary.*` in [`GLOSSARY.json`](GLOSSARY.json) in the same PR. The doctrine doesn't change for each new word.
- **A new locale or regional variant** — create `TERMINOLOGY_<LOCALE>.md` (doctrine) and a corresponding override block in [`GLOSSARY.json`](GLOSSARY.json) (data).

## The contract in five lines

1. **One voice across every locale** — calm, opinionated, second-person informal (`du`/`tu`/`you`). The narrator does not change between languages.
2. **UI wins over the glossary** — if the shipped UI string and `GLOSSARY.json` disagree, update the glossary.
3. **Three loanword buckets** govern every English noun in DE/FR prose — _always English_, _established loanwords_, _translate (must)_. Contents at `alwaysEnglish`, `establishedLoanwords`, `translateBucket`, `gitDomainLoanwords` in `GLOSSARY.json`.
4. **No formal pronouns** — never `Sie`, never `vous`, never their inflections.
5. **No drift modes** — German must not drift into passive bureaucracy; French must not drift into marketing softening; neither locale half-translates compound terms.

## Before-commit scan

Run this scan on every translated string and every docs page:

1. **Voice.** Reads calm and opinionated, with the _why_ present? Not bureaucratic in German, not marketing-soft in French? No `we`, no marketing softeners?
2. **Pronoun.** No `Sie` / `Ihnen` / `Ihre` in DE. No `vous` / `votre` / `vos` in FR.
3. **Loanwords.** Every English noun in DE/FR prose belongs to Bucket 1 (`alwaysEnglish`), Bucket 2 (`establishedLoanwords` + `gitDomainLoanwords`), or it's a bug. Bucket 3 entries (`translateBucket`) must always translate.
4. **No half-translated compounds.** Read each multi-word technical term aloud. If the language switches mid-word, the compound is broken.
5. **UI labels.** Every name of a button, menu, panel, or feature matches the string in `services/platform/messages/<locale>.json` verbatim.
6. **Per-locale anti-patterns.**
   - **DE**: no `Wird X…` passive present, no sentence-final `erfolgreich`, no `Damit` sentence opener, no compound stacks longer than three roots, no gender disagreement on the closed noun set (`nounGenders.de`).
   - **FR**: no marketing softeners (`Découvrez`, `N'hésitez pas à`, `tout simplement`, `il vous suffit de`), respect non-breaking-space rules before `:;!?%`.
7. **Numbers, dates, quotation marks.** Locale conventions applied in prose. Canonical formats kept inside code fences and frontmatter.

The docs test suite ([`services/docs/tests/`](../../services/docs/tests/)) automates checks 2 and 3 (and a subset of check 5). The other checks are on you.

## How the JSON test scaffolding sees these rules

The tests in [`services/docs/tests/`](../../services/docs/tests/) read [`GLOSSARY.json`](GLOSSARY.json) and apply four checks across DE/FR/`de-CH` docs pages:

- **[`terminology.test.ts`](../../services/docs/tests/terminology.test.ts)** — hard-fail. For every `(en, native)` pair in `enToLocale[locale]` where `en !== native`, the test rejects the English form appearing in the page body. For every word in `formalPronouns[locale]`, the test rejects the formal pronoun.
- **[`loanword.test.ts`](../../services/docs/tests/loanword.test.ts)** — hard-fail. For every `{ en, native }` pair in `translateBucket[locale]`, the test rejects the English form appearing in the page body.
- **[`grammar-de.test.ts`](../../services/docs/tests/grammar-de.test.ts)** — warn-only. For every German noun in `nounGenders.de`, the test flags indefinite-article disagreement (`einen <fem-noun>`, `eine <masc-noun>`, etc.). Promote to hard-fail once the rewrite sweep clears the existing corpus.
- **All checks mask code fences, inline-code spans, and link URLs** before scanning, so a UI-bucket noun inside ` ```http ` blocks or inside `/api-reference#headers` URLs is not flagged.

The other glossary sections (`establishedLoanwords`, `gitDomainLoanwords`, `productVocabulary`, `marketingSofteners`, `antiPatternExamples`, `toastConventions`, `errorMessagePatterns`, `abbreviations`, `styleConventions`, `roleNames`, `antiPatterns`, `deCH`) are read by humans and reviewers — they document the rules the tests do not yet catch.
