# Adding a new locale

This directory holds the per-locale address-detection bundles. Each file
exports an `AddressFormBundle` — an ordered array of regex form strings
plus a small metadata object — that the address detector composes into the
final pattern.

The current address pipeline lives at
[`../index.ts`](../index.ts); shared building blocks (street-name token,
house-number regex, postcode+city tail, country-suffix tail, Unicode
boundary helpers) live at [`../builders.ts`](../builders.ts).

## Checklist for a new locale

1. **Pick the ISO 639-1 code** (or BCP 47 tag for script variants such as
   `zh-Hans` / `zh-Hant`). Place the new file as `<code>.ts`.

2. **Document the postal convention** in a short top-of-file comment. State:
   - Address ordering (e.g. "JP: country → prefecture → city → ward →
     street").
   - Postcode format (e.g. `〒NNN-NNNN`).
   - Whether commas, line breaks, or spaces separate parts.
   - Which characters / scripts appear (Latin only? Cyrillic + Latin
     mixed? Indic? CJK?).
   - Citations to the national post authority's format spec where
     possible.

3. **Reuse builders before inventing primitives.** Add a missing builder to
   [`../builders.ts`](../builders.ts) only when no existing primitive
   fits. New builders are shared across locales, so name them generically
   (`POSTCODE_ANCHORED_FORM`, not `JP_POSTCODE_FORM`).

4. **Write the forms list, longest first.** JavaScript regex alternation is
   leftmost-first — order the forms so the more specific (longer) match
   wins before a shorter one greedily fires.

5. **Add Title-Case / Unicode-boundary post-filters in `validate`**, not in
   the regex. `/i` flag case-folds character classes (ECMA-262 §22.2.2),
   so embedding `[A-Z]` inside the regex is a no-op. The detector layer
   runs `validate(matchedText)` after the regex match — that's where
   "must contain at least one uppercase letter" goes.

6. **Seed the locale's prose dataset.** Add
   `services/platform/scripts/pii-fixtures/datasets/<code>/prose.json` with
   200+ PII-free sentences (Tatoeba dump for the language, or hand-curated
   for low-resource locales). The generator uses this for negative-case
   prose.

7. **Run the generator scoped to the locale** and inspect:

   ```bash
   cd services/platform && bun run fixtures:gen -- --lang <code>
   cd services/platform && bunx vitest --project pii -- <code>
   ```

8. **Review false positives.** Pay attention to:
   - Common nouns that share a stem with a street keyword
     ("avenue of trees" should NOT match in EN).
   - Numeric prose that looks like a postcode but isn't (room numbers,
     years, prices).
   - Names of well-known places mentioned in non-address contexts ("I
     went to Trafalgar Square last week").

9. **Commit dataset + fixtures + locale module together.** The PR is large
   but each piece is reviewable: the new pattern code, the data snapshot,
   the generated fixtures.

## Locale module shape

```ts
// src/patterns/address/locales/xx.ts
import type { AddressFormBundle } from '../types';

/**
 * Postal conventions for <Language Name> (<region/country codes>):
 *   - <ordering>
 *   - <postcode format>
 *   - <separators>
 *
 * References:
 *   - <official format spec URL>
 */
export const bundle: AddressFormBundle = {
  locale: 'xx',
  forms: [
    /* one regex string per form, longest first */
  ],
  validate: (m) => /[A-Z]/.test(m), // optional post-filter
};
```

The address detector's `index.ts` reads `bundle.forms`, joins them with
`|`, and compiles the result once per locale. The `validate` is run on
every match as a post-filter (mirrors the existing `BUILT_IN_PII_PATTERNS`
contract).
