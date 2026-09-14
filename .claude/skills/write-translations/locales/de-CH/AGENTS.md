# Swiss German regional overlay

Use written Swiss Standard German, with the same informal `du` voice as
[German](../de/AGENTS.md). This is a sparse `de-CH → de → en` fallback overlay. Add an override
when the text needs to differ for Swiss readers; do not copy the full German catalog.

## What changes

Use `ss` instead of `ß`, Swiss prose quotation marks `«…»`, decimal points, and apostrophe
thousands separators such as `1'000`. Preserve the message file's quote conventions and all code
syntax. See [CONVENTIONS.md](../../CONVENTIONS.md) and the
[locale style data](../../../../../packages/ui/src/i18n/tests/locales/de-CH/).

Do not make global replacements in identifiers, URLs, quoted UI labels, or literal code. Resolve
a UI label through the actual locale fallback; the docs must name the displayed value.

## What does not change

A language preference does not select a contract or deployment region. Keep the same permissions,
limits, quantities, billed currency, retention periods, and legal jurisdiction as the source.
CHF is appropriate only when the underlying fact is already denominated in CHF. A GDPR reference
must not become a Swiss-law reference through translation.

When a currency heuristic rejects a factual amount, apply the documented narrow exception with a
reason. Never swap currency symbols to satisfy lint. Verify overrides and their fallback behavior
in the rendered UI and docs, including orphan keys and Swiss spelling.

Read [examples.md](examples.md) for regional formatting examples.
