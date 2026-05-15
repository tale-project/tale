# Swiss German (de-CH) terminology

Variant of German (de). Read [`TERMINOLOGY.md`](TERMINOLOGY.md) and [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md) first — those rules apply here too. **This file lists only what differs from the German base.**

Swiss High German (Schweizer Hochdeutsch) is the written form used in Swiss documentation. It is **not** Swiss German dialect (Schwyzerdütsch), which Tale does not write.

This file is **doctrine only**: the rules that govern the Swiss overlay. Every concrete word list — the spelling deltas (`ß → ss`), lexical overrides, number formatting, legal authority references, and the "do not override" set — lives at `deCH` in [`GLOSSARY.json`](GLOSSARY.json).

---

## 1 · The override-only rule

`de-CH` is a sparse overlay on top of `de`. Anything the Swiss variant does not override falls back to the German base automatically, in both messages and docs:

- **Messages**: `de-CH.json` keys missing → fall back to `de.json` → fall back to `en.json`.
- **Docs**: `docs/de-CH/<path>.md` missing → fall back to `docs/de/<path>.md` → fall back to `docs/en/<path>.md`.

This has one consequence that drift kept missing: **do not copy the German base into `de-CH.json` or `docs/de-CH/` just to feel complete**. Every key or page in the Swiss tree should be there because its Swiss value genuinely differs from the German one. If a `de-CH` value is byte-identical to its `de` counterpart, delete it.

The Swiss tree was built that way originally and then drifted — `de-CH` ended up with arbitrary partial coverage. The fix is to (a) sync from `de` with `ß → ss` applied, then (b) strip every byte-identical override so the result is genuinely override-only.

### Maintenance loop

When `de/` changes:

1. Re-run the sync helper (`python3 scripts/sync_de_ch.py` or equivalent) — it copies the new `de/` content into `de-CH/`, applies `ß → ss`, and deletes files that match `de/` byte-for-byte after the substitution.
2. Review any remaining `de-CH` files: are they Swiss-specific because of CHF, Swiss legal references, or Swiss number formatting? If not, delete them too.

---

## 2 · Spelling: no "ß"

The single largest difference: **Swiss German does not use "ß".** Replace every "ß" with "ss" in any Swiss override. The closed table of common substitutions lives at `deCH.spellingDeltas` in [`GLOSSARY.json`](GLOSSARY.json).

Most of Tale's German text already avoids `ß` in spots where the substitution is invisible (Tale's `de/` files use `muss`, `lässt`, `dass`), but the substitution has to be applied consistently in every Swiss override.

---

## 3 · Lexical overrides

Swiss German accepts more English loanwords than standard German and has some distinct vocabulary. Only override when the Swiss form is clearly preferred; avoid forcing Helvetisms for their own sake. In practice, most Tale UI and docs strings need no lexical Swiss override — the `ß → ss` substitution is the main mechanical transform.

The list of lexical overrides (and when each one is worth applying) lives at `deCH.lexicalOverrides` in [`GLOSSARY.json`](GLOSSARY.json).

---

## 4 · Currency and numbers

Swiss number formatting differs from German formatting in two ways: the decimal separator is the period (like English), and the thousands separator is the apostrophe. Currency in Swiss-specific pricing examples is **CHF**, placed before the value (`CHF 100`, not `100 CHF`), matching Swiss official style.

The machine-readable forms live at `deCH.numberFormatting` and `styleConventions.de-CH` in [`GLOSSARY.json`](GLOSSARY.json).

---

## 5 · Legal and authority references

Where a doc mentions a supervisory authority:

- Switzerland's authority is the **Eidgenössischer Datenschutz- und Öffentlichkeitsbeauftragter (EDÖB)** — already referenced in the base German legal pages because Ruler GmbH is Swiss-based. No Swiss override typically needed.
- The base legal pages already reflect Swiss law (LPD/FADP/DSG) as the governing law. Do not "Germanise" them when writing the Swiss variant.

The full list of authority references with expansions and scope lives at `deCH.legalAuthorities` in [`GLOSSARY.json`](GLOSSARY.json).

---

## 6 · Style

- **Spelling:** `ss` everywhere for `ß`. Otherwise identical to standard German.
- **Quotation marks:** `«Swiss guillemets»` are the traditional form, but `„German quotes"` are also accepted. Use «guillemets» in running prose; straight quotes inside UI and code blocks. In shared docs pages, matching the base German style (`„text"`) is acceptable.
- **Apostrophes:** straight ASCII `'` (same as base). The thousands-separator `'` in `1'000` is the same character — keep it ASCII so figures parse cleanly.
- **Decimal period, thousands apostrophe** — override when a figure appears in prose that is meant to be read as Swiss.
- **Currency:** CHF in Swiss-specific examples. Symbol before the value.

---

## 7 · Do not override

The Swiss variant has no business changing product feature names, role names, code identifiers, API endpoints, brand names, code-fence contents, the translate-bucket terms, or the voice rules. The full closed list lives at `deCH.doNotOverride` in [`GLOSSARY.json`](GLOSSARY.json) — consult it when in doubt about whether a given delta belongs in `docs/de-CH/`.
