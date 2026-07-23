# German (de) — voice doctrine

This file covers every value in `services/*/messages/de.yml`, every page under `docs/de/`, and (via fallback) the de-CH variants where overrides are absent. The cross-locale contract is at [`../../SKILL.md`](../../SKILL.md); read that first.

## The voice in this language

German Tale prose is calm, opinionated, and active. Verbs do the work; nominal phrases stay short; the second-person `du` is the only address. The German narrator is the same narrator as the English one — terse, why-before-what, never apologetic. Verb-final subordinate clauses are permitted but never required; the writer picks the construction that reads native, not the construction that mirrors the English source.

> **Positive example.** Öffne **Einstellungen > Mitglieder** und klicke auf **Mitglied einladen**. Das neue Mitglied bekommt eine E-Mail mit einem Link, der 24 Stunden gültig ist; die Standardrolle setzt du im Formular, bevor du auf Senden klickst.

Three sentences, active verbs (`öffne`, `klicke`, `bekommt`, `setzt`), no `Sie`, no `Wird X…`, no `erfolgreich`. Compound nouns are whole (`Standardrolle`, never `Standard-Rolle` or `Standard Rolle`).

## The drift mode this language slips into

German prose drifts into bureaucracy. Four named patterns recur — each catalogued in [drift-catalogue.md](drift-catalogue.md):

1. **Passive present** — `Wird gespeichert…`, `Wird ausgeführt...` (verified 35 occurrences in `services/platform/messages/de.yml`). Hides the agent and adds three characters the UI doesn't have room for.
2. **Sentence-final `erfolgreich`** — `Mitglied erfolgreich aktualisiert`. Redundant in a toast.
3. **`Damit` opener** — translator's tic; verb-first reads native.
4. **Calques** — `Vertrauenshaltung` (for trust posture), `Nutzerreise` (for user journey). Translate the meaning, not the noun.

> **Drift → target.** `Wird gespeichert…` → `Speichert…`. The passive hides the system; the active says what's happening.

The regex-checkable forms live in [`packages/ui/src/i18n/tests/locales/de/voice.ts`](../../../../../packages/ui/src/i18n/tests/locales/de/voice.ts) (caught by `voice-drift`). The Wird rule is value-shape-aware so legit declarative-passive (`Wird verwendet, wenn der Standardmodus Sperrliste ist.`) doesn't trip the check.

## Conventions

See [CONVENTIONS.md](../../CONVENTIONS.md) for the template; values below are DE's.

| Surface                          | Rule                                                                    |
| -------------------------------- | ----------------------------------------------------------------------- |
| Pronoun (informal you)           | `du` — never `Sie` (sentence-initial `Sie` is a third-person carve-out) |
| Quotation marks (prose)          | `„text"` (low-9 + high-9)                                               |
| Quotation marks (message file)   | ASCII `"` — curly quotes are prose-only                                 |
| Apostrophe (prose)               | ASCII `'`                                                               |
| Apostrophe (message file & code) | ASCII `'`                                                               |
| Dates (prose)                    | `19.04.2026` (DD.MM.YYYY)                                               |
| Dates (code / ISO)               | `2026-04-19`                                                            |
| Time (wall clock)                | 24-hour: `09:00`, `22:30`                                               |
| Decimal separator                | `,`                                                                     |
| Thousands separator              | `.` or thin space                                                       |
| Currency                         | `100 €` (suffix, NBSP)                                                  |
| Percent                          | `5 %` (NBSP between number and `%`)                                     |
| Spelling                         | `ß` after long vowels / diphthongs (`Straße`, `groß`, `schließen`)      |
| En-dash for ranges               | yes: `2010–2020`                                                        |
| Em-dash style                    | spaced `—`                                                              |

## Loanword stance

German keeps bucket-1 and bucket-2 English; bucket-3 (translate-bucket) terms translate to their German forms. The full lists live in [`../../BUCKETS.md`](../../BUCKETS.md). High-frequency reminders:

- **Stay English in DE prose:** `Workflow`, `Dashboard`, `Cloud`, `Webhook`, `Prompt`, `Token`, `Server`, `Pipeline`, `Pull Request`, `Branch`, `Merge`, `Commit`, `Code Review`.
- **Translate in DE prose:** `Header` → `Kopfzeile`, `Request` → `Anfrage`, `Email` → `E-Mail`, `Help Center` → `Hilfe-Center`, `Draft` → `Entwurf`, `Attachment` → `Anhang`, `Self-hosted` → `selbst gehostet`, `Sales Research` → `Vertriebs-Recherche`.
- **Compounds in DE:** Hyphenate when forming a compound with a bucket-2 loanword: `Webhook-Adresse`, `Workflow-Schritt`, `API-Schlüssel`. Compound translate-bucket terms translate whole: `Knowledge Base` → `Wissensdatenbank`.

## What ships untranslated

| EN        | DE          |
| --------- | ----------- |
| Owner     | Inhaber     |
| Admin     | Admin       |
| Developer | Entwickler  |
| Editor    | Redakteur   |
| Member    | Mitglied    |
| Disabled  | Deaktiviert |

Plus every Bucket 1 brand (`Tale`, `Convex`, `OpenRouter`, `GitHub`, `Slack`, `Gmail`, `Outlook`, `Shopify`), acronym (`AI`, `LLM`, `API`, `MCP`, `SSO`, `SAML`), and code identifier.

## When the locale-specific test fires

The DE checks live in [`packages/ui/src/i18n/tests/checks/`](../../../../../packages/ui/src/i18n/tests/checks/) and read [`packages/ui/src/i18n/tests/locales/de/`](../../../../../packages/ui/src/i18n/tests/locales/de/) data.

The most common firings:

- `pronouns-formal` — formal `Sie` / `Ihnen` / `Ihre…` mid-sentence. Rewrite to `du`.
- `voice-drift` — `Wird X…`, sentence-final `erfolgreich`, `Damit` opener, calque. Read [drift-catalogue.md](drift-catalogue.md) for the rationale per pattern.
- `voice-strikes` — `einfach`, `nahtlos`, `intuitiv`, `bequem`, `Entdecke`, `Erlebe`. Demonstrate, don't assert.
- `terminology-loanword` — translate-bucket noun left English. Use the locale form.
- `terminology-half-compound` — `Pull Anfrage`, `Branch-Zweig`, `Knowledge-Datenbank`. Whole compound or whole keep-English.
- `grammar-articles` — `einen Anfrage` should be `eine Anfrage` (Anfrage is feminine).

> **Sample failure.** `[voice-drift] voice-drift — 35 findings: services/platform/messages/de.yml  executing: [de-wird-passive] "Wird ausgeführt..." — use active form ("Speichert...", "Lädt...", "Importiert...")`

## Worked examples

See [examples.md](examples.md) for three positive examples and three drift→target pairs. Read when you need a concrete case; don't read up front.
