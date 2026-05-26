# `.agents/translation/`

The cross-locale translation skill for Tale. The five files in this directory plus the four per-locale folders cover every concern around writing or editing a non-English string anywhere in the monorepo.

| File                                   | What it owns                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                 | The contract. Four rules that fail review, the translator's stance, three-bucket summary, where to read what. Read first.                                                 |
| [BUCKETS.md](BUCKETS.md)               | Full three-bucket loanword policy: always-English / established-loanwords / translate-bucket. Per-bucket term lists; half-compound denylists; bucket-assignment workflow. |
| [CONVENTIONS.md](CONVENTIONS.md)       | The 14-row conventions table template (quotes, apostrophes, dates, numbers, currency, NBSP, ß, dashes) that each locale fills, plus the per-row rationale.                |
| [GLOSSARY_GUIDE.md](GLOSSARY_GUIDE.md) | How the test-time glossary works. Adding a term, choosing a category, `_lintExclude` semantics, the audit script.                                                         |
| [locales/en/](locales/en/)             | English voice doctrine.                                                                                                                                                   |
| [locales/de/](locales/de/)             | German voice doctrine + drift catalogue. Required reading when editing `de.json` or `docs/de/`.                                                                           |
| [locales/fr/](locales/fr/)             | French voice doctrine + drift catalogue. Required reading when editing `fr.json` or `docs/fr/`.                                                                           |
| [locales/de-CH/](locales/de-CH/)       | Swiss German overlay. Only the differences from DE.                                                                                                                       |

The skill is paired with the `docs` skill at [`../docs/`](../docs/) (which owns docs-page structure) and with the test framework at [`../../packages/ui/src/i18n/tests/`](../../packages/ui/src/i18n/tests/) (which enforces the rules).
