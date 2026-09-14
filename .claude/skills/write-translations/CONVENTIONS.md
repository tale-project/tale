# Locale conventions without changing the facts

The per-locale guides and
[style data](../../../packages/ui/src/i18n/tests/locales/) define Tale's prose conventions.
These conventions format content; they do not authorize changing its meaning.

## Surface matters

| Surface | Treatment |
| --- | --- |
| Docs prose | Use the locale's spelling, punctuation, quotation marks, and number/date formatting. |
| Exact UI labels | Reproduce the resolved message value; do not typographically rewrite a quoted label. |
| Message values | Follow the existing catalog's ASCII quote/apostrophe conventions and the component context. |
| Code and identifiers | Preserve bytes, including decimal points, quotes, placeholders, enum values, routes, and keys. |
| Frontmatter dates and machine-readable values | Preserve the required syntax, usually ISO dates. |
| Prices, limits, jurisdictions, timestamps | Preserve the underlying currency, quantity, unit, authority, and instant. Localize presentation only. |

## Prose defaults

| Convention | EN | DE | FR | de-CH |
| --- | --- | --- | --- | --- |
| Address | you | du | tu | du |
| Quotes | `"text"` | `„Text“` | `« texte »` | `«Text»` |
| Apostrophe | ASCII `'` | ASCII `'` | typographic `’` | ASCII `'` |
| Date example | `2026-04-19` or `April 19, 2026` | `19.04.2026` | `19/04/2026` | `19.04.2026` |
| Decimal example | `2.5` | `2,5` | `2,5` | `2.5` |
| Thousands example | `1,000` | `1.000` | `1 000` (NNBSP) | `1'000` |
| Percent example | `5%` | `5 %` | `5 %` | `5 %` |
| Sharp s | — | standard German `ß` | — | `ss` |
| Em dash | unspaced | spaced | spaced | spaced |

French uses nonbreaking spaces before `:;!?%»` and after `«`; use U+202F for thousands and the
configured U+00A0 punctuation spacing. Prefer words or sentence breaks when a dash makes a
sentence harder to read. En dashes express number ranges when the surrounding syntax allows it.
Keep time zones explicit where scheduling or observed timestamps depend on them.

## Currency and legal content

The current style checks carry preferred currencies per locale. Those are lint defaults, not
exchange rates or product pricing. An amount billed in USD remains USD in DE, FR, and de-CH.
Do not replace EUR with CHF or substitute a Swiss law for an EU law. Translate the name of the
same law when appropriate; legal revisions require their own authoritative basis and scope.

`noCurrencyCheck: true` exists for docs with legitimate currencies outside the locale default.
Use it with a reason when needed. Other exceptions follow the actual check configuration; do not
add broad exclusions or change numerical facts to satisfy a typography rule.

## Extending checks

Inspect the relevant check and locale data before claiming it enforces a convention. Some checks
are heuristics or report-only. For a new enforceable rule, update its typed configuration and
applicable locales, register the check, and add positive and negative fixtures. Review sentence
flow and idiom separately; a punctuation check cannot establish native quality.
