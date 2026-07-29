# Conventions template

Every locale's `AGENTS.md` fills the table below: this file states the _why_ a translator needs once;
the per-locale file states the _what_ for its language. The framework enforces every row via per-locale
data in
[`packages/ui/src/i18n/tests/locales/<locale>/style.ts`](../../../packages/ui/src/i18n/tests/locales/);
when a check fires, its message names the rule and points here.

## The 14-row conventions table

| Row | Surface                          | What it controls                                                                                                             | Why                                                                                                                                                          |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Pronoun (informal you)           | `du` / `tu` / `you` — never `Sie` / `vous`                                                                                   | One narrator across locales; formal pronouns put distance between Tale and the reader.                                                                       |
| 2   | Quotation marks (prose)          | EN: `"…"` / DE: `„…"` (low-9 + high-9) / DE-CH: `«…»` / FR: `« text »` with NBSP                                             | The local typographic convention is what native readers expect; ASCII straight quotes in German prose mark a translation.                                    |
| 3   | Quotation marks (message file)   | ASCII `"` in every locale                                                                                                    | Curly quotes are prose-only — `style-quotes` targets docs markdown, not message values (and rejects them in EN). YAML accepts either; UI strings stay ASCII. |
| 4   | Apostrophe (prose)               | EN/DE: ASCII `'` / FR: typographic `’`                                                                                       | French prose uses the typographic apostrophe (`l'équipe`); English and German never.                                                                         |
| 5   | Apostrophe (message file & code) | ASCII `'` in every locale                                                                                                    | `style-apostrophes` checks prose only, never message values; the typographic `’` is a FR-prose rule. UI strings and code stay ASCII.                         |
| 6   | Dates (prose)                    | EN: ISO or "Month D, YYYY" / DE / DE-CH: `19.04.2026` / FR: `19/04/2026`                                                     | National date conventions. ISO is universal in code/frontmatter.                                                                                             |
| 7   | Dates (code / ISO)               | `2026-04-19` everywhere                                                                                                      | ISO 8601; appears in frontmatter and code blocks.                                                                                                            |
| 8   | Time (wall clock)                | EN: 12-hour (`9 am`) / DE / DE-CH / FR: 24-hour (`09:00`)                                                                    | Local convention.                                                                                                                                            |
| 9   | Decimal separator                | EN: `.` / DE / FR: `,` / DE-CH: `.` (Swiss exception)                                                                        | Thousand-separator pairs with it; mixing the pair is a tell.                                                                                                 |
| 10  | Thousands separator              | EN: `,` / DE: `.` or thin space / DE-CH: `'` (apostrophe: `1'000`) / FR: NNBSP (U+202F)                                      | Same as row 9.                                                                                                                                               |
| 11  | Currency                         | EN: `$100` (USD, prefix) / DE / FR: `100 €` (suffix, NBSP) / DE-CH: `CHF 100` (prefix)                                       | Local currency + symbol placement; check rejects symbols from other locales.                                                                                 |
| 12  | Percent                          | EN: `5%` / DE / DE-CH / FR: `5 %` with NBSP                                                                                  | NBSP between number and `%` in the metric-using locales; check rejects regular space and missing space.                                                      |
| 13  | Spelling (ß)                     | DE: `ß` after long vowels (`Straße`, `groß`, `schließen`) / DE-CH: never (`Strasse`, `gross`, `schliessen`)                  | Swiss German never uses ß; the Duden rule for ß in DE is well-defined.                                                                                       |
| 14  | Dashes                           | EN: em-dash unspaced (`a—b`) / DE / DE-CH / FR: em-dash spaced (`a — b`); en-dash for number ranges everywhere (`2010–2020`) | English uses tight em-dashes; the metric languages space them. Number ranges use en-dash universally.                                                        |

The enforcing checks: `style-quotes`, `style-apostrophes`, `style-dates`, `style-numbers`,
`style-currency`, `style-percent-nbsp`, `style-nbsp`, `style-em-dash`, `style-en-dash`, `style-ss`
(registered in [`tests/registry.ts`](../../../packages/ui/src/i18n/tests/registry.ts)).

## Why these rows and not more

This is the smallest set that catches the surface bugs breaking the _feel_ of native text — punctuation,
currency, and spelling read native or they don't. Beyond row 14 is reviewer territory: sentence flow,
idiomatic phrasing, register beyond pronouns. The check stops where reviewer judgment starts.

## Adding a convention row

1. Extend `LocaleStyleConfig` in
   [`packages/ui/src/i18n/tests/locales/types.ts`](../../../packages/ui/src/i18n/tests/locales/types.ts)
   with the new field.
2. Add the value to every locale's `style.ts` (the type-checker forces this).
3. Add a check module under
   [`packages/ui/src/i18n/tests/checks/`](../../../packages/ui/src/i18n/tests/checks/) that reads the
   field and emits findings; register it.
4. Add a planted fixture under each applicable locale's `planted/<check-id>/`.
5. Append a row above with its rationale.

The meta-test
([`packages/ui/src/i18n/tests/__meta__/meta.test.ts`](../../../packages/ui/src/i18n/tests/__meta__/meta.test.ts))
verifies every check is registered and every locale config carries its concern fields.
