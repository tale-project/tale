# Swiss German (de-CH) — overlay

A sparse overlay on top of [DE](../de/AGENTS.md). The fallback chain `de-CH → de → en` covers every value not overridden here.

## When to override

Override a value only when it genuinely differs from DE for a Swiss reader. Otherwise rely on the DE fallback. The framework's `parity` check allows de-CH to be partial; only orphan keys (in de-CH but not in en) fail.

## What is different from DE

1. **No `ß`.** Every sharp-s is `ss` — `Strasse`, `gross`, `schliessen`, `Standardmässig`, `gemäss`, `heisst`. Caught by `style-ss` (enforced from day one — the de-CH messages are currently clean).
2. **Quote convention.** Prose uses `«…»` (Swiss guillemets) or `„…"`; both accepted. Message values use ASCII.
3. **Numbers.** Decimal period (`2.5` like EN, unlike DE `2,5`); thousands apostrophe (`1'000`, unlike DE `1.000`).
4. **Currency.** `CHF 100` (prefix), not `100 €`. Catches `$` and `€` in de-CH prose via `style-currency`.
5. **Legal references.** Swiss authorities (EDÖB / FADP / LPD / DSG) replace EU references (GDPR / DSGVO). Reviewer-caught.

## What is the same as DE

- Voice — calm, opinionated, active, `du`. The Swiss reader hears the same narrator with Swiss typography.
- Loanword stance — DE buckets apply. `Pull Request`, `Workflow`, `Webhook` stay English; `Header → Kopfzeile`, `Email → E-Mail` translate.
- Drift modes — `Wird X…`, sentence-final `erfolgreich`, `Damit` opener. Same regex denylist as DE.
- Grammar — same noun-gender map; `einen Anfrage` fails the same way.

## Conventions

| Surface                 | Rule                      | Different from DE?                  |
| ----------------------- | ------------------------- | ----------------------------------- |
| Pronoun                 | `du`                      | no                                  |
| Quotation marks (prose) | `«…»` (Swiss) or `„…"`    | yes — `«…»` is the Swiss default    |
| Apostrophe (prose)      | ASCII `'`                 | no                                  |
| Dates (prose)           | `19.04.2026`              | no                                  |
| Decimal separator       | `.`                       | yes — DE uses `,`                   |
| Thousands separator     | `'` (apostrophe: `1'000`) | yes — DE uses `.` or thin space     |
| Currency                | `CHF 100` (prefix)        | yes — DE uses `100 €`               |
| Spelling (ß)            | NEVER — always `ss`       | yes — DE uses `ß` after long vowels |

## What ships untranslated

Same role names as DE (`Inhaber`, `Admin`, `Entwickler`, `Redakteur`, `Mitglied`, `Deaktiviert`). Same Bucket 1 and Bucket 2.

## When the locale-specific test fires

- `style-ss` (enforced) — `ß` anywhere. Replace with `ss`.
- `style-numbers` — wrong separator pair. Use `.` decimal and `'` thousands.
- `style-currency` — `$` or `€` in prose. Use `CHF`.
- Everything from the [DE locale checks](../de/AGENTS.md#when-the-locale-specific-test-fires) — they apply via the fallback chain.

## Worked examples

See [examples.md](examples.md). Most DE examples apply to de-CH after the `ß → ss` substitution and currency swap.
