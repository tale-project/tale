# Swiss French (fr-CH) terminology

Variant of French (fr). Read [`TERMINOLOGY.md`](TERMINOLOGY.md) and [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md) first — those rules apply here too. **This file lists only what differs from the French base.**

Swiss French ("français de Suisse") is the written form used in French-speaking Switzerland (Romandie). It is very close to metropolitan French, with a handful of numeric and lexical differences.

## Where to put overrides

- **UI (platform):** `services/platform/messages/fr-CH.json`. Include only the keys whose values differ from `fr.json`. Anything missing falls back to `fr.json` automatically.
- **Docs (Mintlify):** `docs/.locale-overrides/fr-CH/<same-path-as-base>.md`. Full-file override — the generator uses it in place of the `docs/fr/` file.

## Numbers: septante, huitante, nonante

The most well-known difference: Swiss French uses single-word forms for 70, 80 and 90 instead of the French compound forms. Override only when a doc explicitly writes numbers out in words (rare in Tale content).

| Metropolitan French (fr) | Swiss French (fr-CH)                                   |
| ------------------------ | ------------------------------------------------------ |
| soixante-dix             | septante                                               |
| quatre-vingts            | huitante _(VD, VS, FR)_ / quatre-vingts _(GE, NE, JU)_ |
| quatre-vingt-dix         | nonante                                                |

Note that "huitante" is only used in some cantons (Vaud, Valais, Fribourg). In Geneva, Neuchâtel, and Jura, the metropolitan "quatre-vingts" is used. Unless you know the target audience, prefer "quatre-vingts" for 80, and override only `septante`/`nonante`.

Numeric form (`70`, `80`, `90`) needs no override — the digits are the same in every French locale.

## Lexical overrides

Swiss French has a handful of distinct vocabulary items. Most do not appear in Tale content. Do not force Helvetisms where the metropolitan form is equally natural to a Swiss reader.

| Metropolitan French (fr) | Swiss French (fr-CH) | Notes                     |
| ------------------------ | -------------------- | ------------------------- |
| Petit-déjeuner           | Déjeuner             | Unlikely in Tale content  |
| Déjeuner                 | Dîner                | Unlikely in Tale content  |
| Dîner                    | Souper               | Unlikely in Tale content  |
| Téléphoner               | Téléphoner           | Same                      |
| E-mail                   | E-mail               | Same — no override needed |
| Week-end                 | Week-end             | Same                      |

## Currency and numbers

- CURRENCY in examples or pricing: **CHF** for Switzerland (not EUR). If the base uses EUR in a Swiss-specific context, override with CHF.
- DECIMAL separator: point (`2.5 Go`) in Swiss French — different from metropolitan French, which uses a comma. This is the biggest day-to-day number-formatting difference.
- THOUSANDS separator: apostrophe (`1'000`) is the Swiss standard. Narrow space is also accepted. Comma is not used as a thousands separator.
- DATES: `DD.MM.YYYY` is the Swiss preferred form (different from metropolitan `DD/MM/YYYY`). In frontmatter and technical context, keep ISO (`2026-04-19`).
- TIME: 24-hour (same as base). The form `09 h 00` is also standard in Switzerland.

## Typography

- NON-BREAKING SPACE before `:`, `;`, `!`, `?`, `%`, and inside `« … »` — **same rule as metropolitan French.** Swiss French follows the same typographic convention, so no override is needed for punctuation spacing.
- QUOTATION marks: « guillemets » (same as base).
- APOSTROPHES: typographic `’` in docs prose (same as base). The thousands-separator `'` in `1'000` stays straight ASCII — it is a numeric separator, not a typographic apostrophe.

## Legal / authority references

- Switzerland's data-protection authority is the **Préposé fédéral à la protection des données et à la transparence (PFPDT)** — already referenced in the base French legal pages because Ruler GmbH is Swiss-based. No Swiss override typically needed.
- The base legal pages already reflect Swiss law (LPD/FADP) as the governing law. Do not replace with French or EU law in the Swiss variant.

## Style

- Everything else — tone, informal "tu", sentence-case headings, ICU placeholders, Markdown rules — follows the French base. No changes.

## Do not override

- Product feature names (Workflow, Dashboard, Canvas, Prompt Library, etc.) — keep English, same as base.
- Role names (Owner, Admin, Developer, Editor, Member) — keep English, same as base.
- Code, command output, environment variable names, CLI flags.
- API endpoints, JSON keys, error codes.
- External brand names.
