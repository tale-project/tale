---
name: terminology
description: The cross-locale terminology contract for the Tale platform UI, marketing site, and docs site — covering English source forms AND every translation, with per-language tone rules, the loanword policy, and the canonical UI label tables. Use whenever writing or editing any user-facing string in `services/platform/messages/*.json`, `services/web/messages/*.json`, `services/docs/messages/*.json`, or pages under `docs/`.
---

# Tale terminology — the contract

This skill is the authoritative source for how every product term renders **in every locale, including English**. English is not exempt — it has its own spelling, capitalisation, and style rules in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md). Translations derive from the English form; each locale then layers its own conventions on top.

The contract is structured as three rings:

1. **Cross-locale ring** — [`TERMINOLOGY.md`](TERMINOLOGY.md). The policy that applies in every locale: voice, loanword policy, length parity, error-message style, plurals, placeholders, brand names, role names, dates, numbers, quotation marks. Read this first.
2. **Per-locale ring** — `TERMINOLOGY_<LOCALE>.md`. The comprehensive term tables (product features, KB entities, technical vocabulary, actions, deployment, roles), the per-language tone rules, and the language-specific anti-pattern catalogue.
3. **Machine ring** — [`GLOSSARY.json`](GLOSSARY.json). The structured projection consumed by [`services/docs/tests/`](../../services/docs/tests/). Three sections: `enToLocale` (the canonical EN→native mapping, hard-fail), `formalPronouns` (the wrong-politeness-form indicator list), `translateBucket` (English nouns that have a native equivalent and must be translated). When the markdown and the JSON disagree, the markdown wins; the JSON is regenerated from the markdown source.

Three surfaces follow these rules:

1. **Platform UI** — `services/platform/messages/*.json`. Labels, buttons, status messages, errors.
2. **Marketing site** — `services/web/messages/*.json`. Long-form marketing copy, FAQs, CTAs.
3. **Docs site** — `docs/**` page bodies plus `services/docs/messages/*.json` chrome strings.

When the shipped UI and a terminology file disagree, the UI wins. Update the terminology file to match, then propagate to docs and marketing.

## Files in this skill

| File                                           | What it owns                                                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`TERMINOLOGY.md`](TERMINOLOGY.md)             | Cross-locale rules: voice, loanword policy (three buckets), length, error messages, plurals, placeholders, brand names, role names, dates, numbers, quotation marks. Read first.                       |
| [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md)       | English source forms. Authoritative for `en.json` and any English prose. Covers product features, KB entities, technical vocabulary, actions, deployment terms, role names, EN style rules.            |
| [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md)       | German base. The voice rules per-language, the bureaucracy-drift anti-pattern catalogue, comprehensive term tables, sentence-level pattern catalogue, German style rules (compounds, quotes, numbers). |
| [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md) | Swiss German overrides only. Inherits everything from `TERMINOLOGY_DE.md`. Lists only what differs: `ß → ss`, CHF, Swiss number formatting, Swiss legal references.                                    |
| [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md)       | French base. The marketing-drift anti-pattern catalogue, comprehensive term tables, sentence-level pattern catalogue, French style rules (non-breaking spaces, quotes, accents).                       |
| [`GLOSSARY.json`](GLOSSARY.json)               | Machine-readable projection consumed by the docs tests. Keep in sync with the markdown — markdown is the human source of truth; JSON is the machine view.                                              |

Add a `TERMINOLOGY_<LOCALE>.md` for any new regional variant. Variants list only what differs from the base; the base file applies to everything else.

## When to use this skill

Always when you touch:

- **Any English string** in `en.json` files, English docs pages, or marketing copy — check [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md). `Knowledge Base` (title-cased) is a bug; `Knowledge base` is correct. `Todo list` is a bug; `Research plan` is correct. `On-premise` is a bug; `On-premises` is correct.
- **Any translated string** in DE/FR/`de-CH` files — check the per-locale terminology file. Quote UI labels verbatim from the locale JSON; use the per-locale tone rules; respect the loanword policy.
- **Docs pages under `docs/[locale]/**`\*\* — same as above. The docs tests enforce a subset of these rules automatically.
- **A new product term being introduced to the UI** — register it in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md), every base locale file, and [`GLOSSARY.json`](GLOSSARY.json) in the same PR.
- **A new locale or regional variant** — create `TERMINOLOGY_<LOCALE>.md` here and extend [`GLOSSARY.json`](GLOSSARY.json).

## The contract in five lines

1. **One voice across every locale** — calm, opinionated, second-person informal (`du`/`tu`/`you`). The narrator does not change between languages.
2. **UI wins over guidelines** — if the shipped UI string and a terminology file disagree, update the terminology file.
3. **Three loanword buckets** — _always English_ (brands, acronyms, code identifiers), _established loanwords_ (kept English in DE/FR — `Workflow`, `Dashboard`, `Cloud`, `Webhook`, `Prompt`, `Token`, `Server`, `Canvas`, `Composer`, `Status`, `Integration`, `Tool`), _translate (must)_ (have native equivalents — `Header`, `Request`, `Provider`, `Email`, `Help Center`, `Billing`, `Sales Research`, `Draft`, `Attachment`, `Self-hosted`, plus FR-only `Engineering`).
4. **No formal pronouns** — never `Sie`, never `vous`, never their inflections.
5. **No drift modes** — German must not drift into passive bureaucracy (`Wird gespeichert…`, sentence-final `erfolgreich`); French must not drift into marketing softening (`Découvrez`, `N'hésitez pas à`).

## Before-commit scan

Run this scan on every translated string and every docs page:

1. **Voice.** Reads calm and opinionated, with the _why_ present? Not bureaucratic in German, not marketing-soft in French? No `we`, no marketing softeners?
2. **Pronoun.** No `Sie` / `Ihnen` / `Ihre` in DE. No `vous` / `votre` / `vos` in FR.
3. **Loanwords.** Every English noun in the prose is either _always English_ (brand, code identifier, acronym), _established loanword_ (`Workflow`, `Dashboard`, `Cloud`, `Webhook`, `Prompt`, `Token`, `Server`, `Canvas`, `Composer`, `Status`, `Integration`, `Tool`), or it's a bug. `Header`, `Request`, `Provider`, `Email`, `Help Center`, `Sales Research`, `Billing`, `Draft`, `Attachment`, `Self-hosted` have native equivalents you must use.
4. **UI labels.** Every name of a button, menu, panel, or feature matches the string in `services/platform/messages/<locale>.json` verbatim.
5. **Per-locale anti-patterns.**
   - **DE**: no `Wird X…` passive present, no sentence-final `erfolgreich`, no `Damit` sentence opener, no compound stacks longer than three roots.
   - **FR**: no marketing softeners (`Découvrez`, `N'hésitez pas à`, `tout simplement`, `il vous suffit de`), respect non-breaking-space rules before `:;!?%`.
6. **Numbers, dates, quotation marks.** Locale conventions applied in prose. Canonical formats kept inside code fences and frontmatter.

The docs test suite ([`services/docs/tests/`](../../services/docs/tests/)) automates checks 2 and 3 and a subset of check 4. The other checks are on you.

## How the JSON test scaffolding sees these rules

The tests in [`services/docs/tests/`](../../services/docs/tests/) read `GLOSSARY.json` and apply three checks across DE/FR/`de-CH` docs pages:

- **`terminology.test.ts`** — hard-fail. For every `(en, native)` pair in `enToLocale[locale]` where `en !== native`, the test rejects the English form appearing in the page body. For every word in `formalPronouns[locale]`, the test rejects the formal pronoun.
- **`loanword.test.ts`** — hard-fail. For every `{ en, native }` pair in `translateBucket[locale]`, the test rejects the English form appearing in the page body. The bucket is the curated set of English nouns whose native equivalents are the right answer in 100% of cases.
- **Both checks mask code fences, inline-code spans, and link URLs** before scanning, so `Header` inside ` ```http ` blocks or inside `/api-reference#headers` URLs is not flagged.

The `enToLocale` and `translateBucket` distinction exists for historical reasons (the bucket landed during the rewrite as a separate machine surface). They're functionally equivalent — when an entry from the bucket has been "graduated" (i.e. proven not to cause false positives), folding it into `enToLocale` keeps the codebase tidy.
