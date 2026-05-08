# Swiss German (de-CH) terminology

Variant of German (de). Read [`TERMINOLOGY.md`](TERMINOLOGY.md) and [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md) first — those rules apply here too. **This file lists only what differs from the German base.**

Swiss High German ("Schweizer Hochdeutsch") is the written form used in Swiss documentation. It is not Swiss German dialect (Schwyzerdütsch), which we never write.

## Where to put overrides

- **UI (platform):** `services/platform/messages/de-CH.json`. Include only the keys whose values differ from `de.json`. Anything missing falls back to `de.json` automatically.
- **Docs (Mintlify):** `docs/.locale-overrides/de-CH/<same-path-as-base>.md`. Full-file override — the generator uses it in place of the `docs/de/` file.

## Spelling: no "ß"

The single largest difference: **Swiss German does not use "ß".** Replace every "ß" with "ss" in any Swiss override.

| Standard German (de) | Swiss German (de-CH) |
| -------------------- | -------------------- |
| Straße               | Strasse              |
| Fuß                  | Fuss                 |
| außerdem             | ausserdem            |
| heißt                | heisst               |
| müssen (same)        | müssen               |

Note that most of Tale's current German text already avoids "ß" (e.g. "muss", "lässt") — but the substitution must be applied consistently in any override.

## Lexical overrides

Swiss German accepts more English loanwords than standard German, and has some distinct vocabulary. Only override when the Swiss form is clearly preferred; avoid forcing Helvetisms for their own sake.

| Standard German (de)    | Swiss German (de-CH) | When to override                                      |
| ----------------------- | -------------------- | ----------------------------------------------------- |
| Bürgersteig             | Trottoir             | Unlikely in Tale content; noted for completeness      |
| Geldbörse / Brieftasche | Portemonnaie         | Unlikely in Tale content                              |
| parken                  | parkieren            | Rarely applicable                                     |
| Velo (bicycle)          | Velo                 | Same; only notable if comparing to standard "Fahrrad" |
| E-Mail                  | E-Mail               | Same — no override needed                             |

In practice, most Tale UI and docs strings need no lexical Swiss override. The "ß" → "ss" substitution is the main mechanical transform.

## Currency and numbers

- CURRENCY in examples or pricing: **CHF** for Switzerland (not EUR). If the base uses EUR in a Swiss-specific context (e.g. pricing page), override with CHF.
- DECIMAL separator: period (`2.5 GB`) rather than comma — Switzerland uses the period, unlike Germany and Austria. This is the biggest day-to-day number-formatting difference.
- THOUSANDS separator: apostrophe (`1'000`) is the Swiss standard in official writing. Narrow space is also accepted. Period is **not** used as a thousands separator in Switzerland.
- DATES: `DD.MM.YYYY` (same as base).
- TIME: 24-hour (same as base).

## Legal / authority references

Where a doc mentions a supervisory authority:

- Switzerland's authority is the **Eidgenössischer Datenschutz- und Öffentlichkeitsbeauftragter (EDÖB)** — already referenced in the base German legal pages because Ruler GmbH is Swiss-based. No Swiss override typically needed.
- The base legal pages already reflect Swiss law (LPD/FADP) as the governing law. Do not "Germanise" them when writing the Swiss variant.

## Style

- SPELLING: "ss" everywhere for "ß". Otherwise identical to standard German.
- QUOTATION marks: «Swiss guillemets» are the traditional form, but `„German quotes“` are also accepted. Use «guillemets» in running prose; straight quotes inside UI and code blocks. In shared Mintlify pages, matching the base German style (`„text“`) is acceptable.
- APOSTROPHES: straight ASCII `'` (same as base). The thousands-separator `'` in `1'000` is the same character — keep it ASCII so figures parse cleanly.
- DECIMAL period, thousands apostrophe — override when a figure appears in prose that is meant to be read as Swiss.
- CURRENCY: CHF in Swiss-specific examples.

## Do not override

- Product feature names (Workflow, Dashboard, Canvas, Prompt Library, etc.) — keep English, same as base.
- Role names (Inhaber, Admin, Entwickler, Redakteur, Mitglied, Deaktiviert) — translate to match the shipped UI, same as base.
- Code, command output, environment variable names, CLI flags. CSS/HTML/JSON stays byte-for-byte identical across locales.
- API endpoints, JSON keys, error codes.
- External brand names.
- Anything inside a code fence — even if it contains a "ß" as sample data.
