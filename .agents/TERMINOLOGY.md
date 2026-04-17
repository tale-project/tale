# Terminology — general rules

Cross-locale rules that apply to every translation. Language-specific terminology tables and style quirks live in `TERMINOLOGY_<LANG>.md` next to this file.

## Length

- KEEP translations roughly the same length as the English source — UI layouts are sized for English. Prefer shorter synonyms or abbreviations when the target language is notably longer (common in German; occasional in French).

## Tone and voice

- PREFER short, scannable labels for buttons and menu items (1-3 words).
- USE informal, direct tone — address the user in the informal form of the language (e.g. "you" in English, "du" in German, "tu" in French).
- AVOID jargon in user-facing strings — prefer plain language over technical terms where possible.

## Error messages

- WRITE error messages that tell the user what happened and what to do next.

## Abbreviations

- USE "e.g." and "i.e." in tooltips/descriptions, not "for example" or "that is" (saves space). Language-specific equivalents are acceptable when they read more naturally.

## Plurals

- USE ICU `one`/`other` for plurals, e.g. `{count, plural, one {# item} other {# items}}`. All supported languages share this structure.

## Placeholders and brand names

- PRESERVE ICU placeholders exactly (`{count, plural, ...}`, `{field}`, `{error, select, ...}`) — never translate placeholder names or reorder their arguments.
- DO NOT translate brand names (Tale, Gmail, Outlook, Shopify, etc.).
