# Terminology — general rules

Cross-locale rules that apply to every translation (both platform UI and the docs site). Language-specific terminology tables and style quirks live alongside this file:

- Base locales: [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md), [`TERMINOLOGY_DE.md`](TERMINOLOGY_DE.md), [`TERMINOLOGY_FR.md`](TERMINOLOGY_FR.md).
- Regional variants: [`TERMINOLOGY_DE_AT.md`](TERMINOLOGY_DE_AT.md), [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md), [`TERMINOLOGY_FR_CH.md`](TERMINOLOGY_FR_CH.md). Each variant file lists only what differs from its base — read the base file first.

## Scope

Three surfaces follow these rules:

1. **Platform UI** — `services/platform/messages/*.json`. Labels, buttons, status messages, errors. Space-constrained.
2. **Marketing site** — `services/web/messages/*.json`. Long-form marketing copy, FAQs, CTAs.
3. **Docs site** — `docs/**` (page bodies) and `services/docs/messages/*.json` (chrome strings: nav, search, 404, footer). Long-form prose, tables, code blocks. More room, more rigour expected.

Where a rule differs between surfaces, the section calls it out. Notably, the **informal-form rule applies to the marketing site too** — Tale addresses prospective customers in the same voice it addresses signed-in users.

## Length

- KEEP translations roughly the same length as the English source — UI layouts are sized for English. Prefer shorter synonyms or abbreviations when the target language is notably longer (common in German; occasional in French).
- In docs, length parity is a soft guideline — clarity wins over line-matching.

## Tone and voice

- PREFER short, scannable labels for buttons and menu items (1-3 words).
- USE informal, direct tone — address the user in the informal form of the language (e.g. "you" in English, "du" in German, "tu" in French).
- AVOID jargon in user-facing strings — prefer plain language over technical terms where possible.
- WRITE in the imperative for docs instructions ("Run `tale deploy`") and UI CTAs ("Save", "Delete"). Avoid "You can…" and "Please…" in both surfaces.

## Error messages

- WRITE error messages that tell the user what happened and what to do next.
- END error messages with a period. One sentence is usually enough.
- NEVER blame the user ("Invalid input" → "Enter a valid email address").

## Abbreviations

- USE "e.g." and "i.e." in tooltips/descriptions, not "for example" or "that is" (saves space). Language-specific equivalents are acceptable when they read more naturally.
- EXPAND an abbreviation on first use in a long-form doc page (e.g. "personally identifiable information (PII)"). In UI labels, assume the reader knows the term from context.

## Plurals

- USE ICU `one`/`other` for plurals, e.g. `{count, plural, one {# item} other {# items}}`. All supported languages share this structure.

## Placeholders and brand names

- PRESERVE ICU placeholders exactly (`{count, plural, ...}`, `{field}`, `{error, select, ...}`) — never translate placeholder names or reorder their arguments.
- DO NOT translate brand names (Tale, Gmail, Outlook, Shopify, Microsoft, Convex, OpenRouter, Claude, GitHub, Slack, etc.).
- DO NOT translate code identifiers, environment variable names, CLI flags, file paths, or JSON keys. `TALE_CONFIG_DIR`, `--detach`, and `providers/openrouter.json` look the same in every locale.

## Product role names

The six platform roles — **Owner**, **Admin**, **Developer**, **Editor**, **Member**, **Disabled** — are proper nouns referring to a specific role in Tale. Each language file specifies whether they stay in English (loanword, matches the UI) or translate. When in doubt, match what the UI shows.

When "member" refers generically to "someone on the team" rather than the capital-M Member role, translate it normally ("Mitglied", "membre"). Reserve the capitalized English form for the role itself.

## UI ↔ docs consistency

- WHEN docs reference a UI label, quote it verbatim in the UI's language for that locale. A German doc that tells the user to click "Speichern" must refer to the button the German UI actually shows.
- WHEN the UI uses an English loanword (e.g. "Dashboard" in German), docs use the same loanword. Do not translate it in prose only to create a mismatch.

## Dates, numbers, units

- DATES in docs use the locale convention (see the language file). In ISO identifiers, log lines, and cron expressions, keep the canonical format (`2026-04-19`, `0 9 * * 1-5`).
- NUMBERS with decimals follow the locale decimal separator (period in English, comma in German/French). Inside code blocks, keep the English format because the runtime expects it.
- TIMES in docs are in **UTC** for anything server-side (cron, scheduled jobs, logs). Wall-clock examples for UI walkthroughs use 24-hour format in every locale.
- UNITS follow SI (MB, GB, s, ms). Keep unit symbols in English (they are international).

## Quotation marks

Each language file specifies its quotation style. As a default:

- Use the locale's primary quotation marks in running prose.
- In UI labels and short strings, use straight quotes (`"`) or none.
- Inside code blocks, leave quotes as-is — they are part of the code.

## Markdown and headings

- SENTENCE case for headings in every locale. `## Agent concepts`, `## Concepts des agents`, `## Agent-Konzepte`.
- ALIGN markdown tables — pipes lined up, cells padded evenly. Reviewers read tables in editors, not just rendered.
- PRESERVE code-block language identifiers (` ```bash `, ` ```json `) — they control syntax highlighting.
- KEEP Mermaid diagram syntax untouched. Translate only node labels and prose captions, never the `-->` arrows, `participant` keywords, or block structures.

## Anchor links across locales

The markdown renderer generates heading anchors from the slugified heading text. When a heading's text differs between locales (which it will, since headings are translated), its anchor differs too. Keep cross-file links within the same locale; do not reuse an English anchor inside a German or French file.
