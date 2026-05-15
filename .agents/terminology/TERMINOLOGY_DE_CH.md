# Swiss German (de-CH) terminology

Variant of German (de). Read [`TERMINOLOGY.md`](TERMINOLOGY.md) and [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md) first — those rules apply here too. **This file lists only what differs from the German base.**

Swiss High German (Schweizer Hochdeutsch) is the written form used in Swiss documentation. It is **not** Swiss German dialect (Schwyzerdütsch), which Tale does not write.

**Where things live.** Doctrine + override tables live in this file. Term lookups live in [`GLOSSARY.json`](GLOSSARY.json) `terms[]` (check the `de_ch` field; falls back to `de` then `en`). Test-data lists live in [`services/docs/tests/data/`](../../services/docs/tests/data/).

---

## 1 · The override-only rule

`de-CH` is a sparse overlay on top of `de`. Anything the Swiss variant does not override falls back to the German base automatically, in both messages and docs:

- **Messages**: `de-CH.json` keys missing → fall back to `de.json` → fall back to `en.json`.
- **Docs**: `docs/de-CH/<path>.md` missing → fall back to `docs/de/<path>.md` → fall back to `docs/en/<path>.md`.
- **Glossary terms**: `terms[].de_ch` missing → fall back to `terms[].de` → fall back to `terms[].en`.

This has one consequence that drift kept missing: **do not copy the German base into `de-CH.json` or `docs/de-CH/` just to feel complete**. Every key or page in the Swiss tree should be there because its Swiss value genuinely differs from the German one. If a `de-CH` value is byte-identical to its `de` counterpart, delete it.

### Maintenance loop

When `de/` changes:

1. Re-run the sync helper — it copies the new `de/` content into `de-CH/`, applies `ß → ss`, and deletes files that match `de/` byte-for-byte after the substitution.
2. Review any remaining `de-CH` files: are they Swiss-specific because of CHF, Swiss legal references, or Swiss number formatting? If not, delete them too.

---

## 2 · Spelling: no "ß"

The single largest difference: **Swiss German does not use "ß".** Replace every "ß" with "ss" in any Swiss override.

| Standard German (de) | Swiss German (de-CH) |
| -------------------- | -------------------- |
| Straße               | Strasse              |
| Fuß                  | Fuss                 |
| außerdem             | ausserdem            |
| heißt                | heisst               |
| muss / lässt (same)  | muss / lässt         |
| groß                 | gross                |
| schließen            | schliessen           |
| Standardmäßig        | Standardmässig       |
| gemäß                | gemäss               |

Most of Tale's German text already avoids `ß` where the substitution is invisible (`muss`, `lässt`, `dass`), but the substitution has to be applied consistently in any override.

---

## 3 · Lexical overrides

Swiss German accepts more English loanwords than standard German and has some distinct vocabulary. Only override when the Swiss form is clearly preferred; avoid forcing Helvetisms for their own sake.

| Standard German (de)    | Swiss German (de-CH) | When to override                                      |
| ----------------------- | -------------------- | ----------------------------------------------------- |
| Bürgersteig             | Trottoir             | Unlikely in Tale content                              |
| Geldbörse / Brieftasche | Portemonnaie         | Unlikely in Tale content                              |
| parken                  | parkieren            | Rarely applicable                                     |
| Velo (bicycle)          | Velo                 | Same; only notable if comparing to standard `Fahrrad` |
| Fußball                 | Fussball             | (`ß → ss`)                                            |
| E-Mail                  | E-Mail               | Same — no override needed                             |

In practice, most Tale UI and docs strings need no lexical Swiss override. The `ß → ss` substitution is the main mechanical transform.

---

## 4 · Currency and numbers

Swiss number formatting differs from German formatting in two ways: the decimal separator is the period (like English), and the thousands separator is the apostrophe.

| Locale    | Decimal | Thousands          | Currency in pricing |
| --------- | ------- | ------------------ | ------------------- |
| EN        | `2.5`   | `1,000`            | `$100`, `€100`      |
| DE        | `2,5`   | `1.000` or `1 000` | `100 €`             |
| **DE-CH** | `2.5`   | `1'000`            | `CHF 100`           |
| FR        | `2,5`   | `1 000`            | `100 €`             |

- **Currency** in examples or pricing: **CHF** for Switzerland (not EUR). If the base uses EUR in a Swiss-specific context, override with CHF.
- **Decimal separator**: **period** (`2.5 GB`) rather than comma.
- **Thousands separator**: **apostrophe** (`1'000`) is the Swiss standard in official writing. Narrow space is also accepted. Period is **not** used as a thousands separator in Switzerland.
- **Dates**: `DD.MM.YYYY` (same as base).
- **Time**: 24-hour (same as base).

---

## 5 · Legal and authority references

Where a doc mentions a supervisory authority:

- Switzerland's authority is the **Eidgenössischer Datenschutz- und Öffentlichkeitsbeauftragter (EDÖB)** — already referenced in the base German legal pages because Ruler GmbH is Swiss-based. No Swiss override typically needed.
- The base legal pages already reflect Swiss law (LPD/FADP/DSG) as the governing law. Do not "Germanise" them when writing the Swiss variant.

The Swiss data-protection act is the **LPD** (Loi sur la protection des données / Bundesgesetz über den Datenschutz / DSG).

---

## 6 · Style

- **Spelling:** `ss` everywhere for `ß`. Otherwise identical to standard German.
- **Quotation marks:** `«Swiss guillemets»` are the traditional form, but `„German quotes"` are also accepted. In shared docs pages, matching the base German style (`„text"`) is acceptable.
- **Apostrophes:** straight ASCII `'`. The thousands-separator `'` in `1'000` is the same character.
- **Currency:** CHF in Swiss-specific examples. Symbol before the value (`CHF 100`).

---

## 7 · Do not override

These either don't change between Germany and Switzerland, or come from cross-locale rules that the Swiss variant has no business contradicting.

- **Product feature names** (`Workflow`, `Dashboard`, `Canvas`, `Prompt-Bibliothek`) — same as the German base.
- **Role names** (`Inhaber`, `Admin`, `Entwickler`, `Redakteur`, `Mitglied`, `Deaktiviert`) — translate to match the shipped UI, same as base.
- **Code, command output, environment variable names, CLI flags.** CSS/HTML/JSON stays byte-for-byte identical across locales.
- **API endpoints, JSON keys, error codes.**
- **External brand names** (Tale, Convex, OpenRouter, GitHub).
- **Anything inside a code fence** — even if it contains a `ß` as sample data.
- **The translate-bucket terms from `TERMINOLOGY_DE.md`** (`Kopfzeile`, `Anfrage`, `Anbieter`, `E-Mail`, `Hilfe-Center`, `Abrechnung`, `Vertriebs-Recherche`, `Entwurf`, `Anhang`, `selbst gehostet`) — same translations apply in Swiss German.
- **The voice rules** — `du` (never `Sie`), active verbs, no marketing softening, no sentence-final `erfolgreich`. Same as base.
