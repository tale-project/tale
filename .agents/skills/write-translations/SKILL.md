---
name: write-translations
description: Author or review localized Tale UI messages, documentation, regional overrides, and glossary terms. Preserve meaning and exact UI labels while writing naturally in each locale, and verify key, content, and ICU parity. Read before editing non-English messages or docs or adding a locale.
---

# Write each language for its readers

Tale addresses readers as a helpful peer: `you` in English, `du` in German and Swiss German, and
`tu` in French. Preserve that relationship and the complete meaning. A good translation uses the
syntax and vocabulary a reader expects in their language; it does not preserve English sentence
shapes merely because they came first.

## Establish scope and sources

Read the repo contract, then the applicable locale guide:
[English](locales/en/AGENTS.md), [German](locales/de/AGENTS.md),
[French](locales/fr/AGENTS.md), or [Swiss German](locales/de-CH/AGENTS.md).
For docs, also follow [write-docs](../write-docs/SKILL.md) and
[docs/AGENTS.md](../../../docs/AGENTS.md).

In the task's note outside the clone, identify the files, reader's task, meaning to preserve,
terminology to verify, and likely language risks. Reuse an existing planning note; no additional
notes skill is needed. For a broad change, track coverage by page and locale, including what has
actually received a native-language read-through.

Use these sources for different questions:

- **Product behavior:** the observed running product, supported by current source and tests.
- **Visible UI wording:** the relevant service's message catalog plus shared UI messages, resolved
  through locale fallback. Match the exact displayed string when naming a control.
- **Approved terminology:** [the glossary](../../../packages/ui/src/i18n/tests/glossary/glossary.yml)
  and its context notes. Read [BUCKETS.md](BUCKETS.md) when a term may stay English.
- **Typography and checks:** [CONVENTIONS.md](CONVENTIONS.md), the locale guide, and
  [the i18n test framework](../../../packages/ui/src/i18n/tests/). Inspect actual check modes;
  advisory findings are not proof of correctness.

When the source is ambiguous or wrong, resolve the meaning before translating. If the UI label is
wrong, fix it and its dependent docs within scope, or describe the shipped label and record the
issue. Do not silently invent a better label that readers cannot find.

## Separate facts from language

Preserve permissions, scope, prerequisites, conditions, negation, defaults, limits, units,
quantities, supported states, warnings, and recovery. “May”, “must”, and “can” are different claims.
Keep brands and technical identifiers exact: message keys, placeholders, routes, filenames,
environment variables, flags, enums, error codes, and JSON keys.

Locale is not jurisdiction or billing configuration. Never change a currency, amount, time zone,
legal authority, certification, retention period, or contract promise to make it look local.
Format a fact for the reader without changing the fact. If a style heuristic objects, inspect its
scope and use the documented narrow exception with a reason; do not alter reality to pass lint.

For docs, preserve equivalent headings, warnings, components, code examples, images, links, and
reader outcomes under the repository's parity checks. Rewrite sentences and paragraph breaks
naturally inside that structure. All full locales ship together. `de-CH` remains a sparse overlay,
not a fourth copied catalog.

## Draft from meaning

Read a complete section, understand what readers need, then write it in the target language.
Split a dense sentence, combine choppy ones, or move a qualifier when that improves clarity while
preserving its scope. Use informal imperatives for instructions; use natural declarative sentences
for explanations. Do not force every sentence to start with a verb or a purpose clause.

Keep terminology stable, but distinguish a UI label from an ordinary noun. A bold control name
must match the catalog; a surrounding sentence still needs the target language's normal grammar.
Translate navigation paths segment by segment. Do not leave English nouns scattered through a
French or German explanation merely because a glossary includes a similar technical term.

Use [the glossary workflow](GLOSSARY_GUIDE.md) for a missing, contradictory, or context-dependent
term. Prefer native wording a reader understands; approved loanwords should support comprehension,
not replace it. A term can require different treatment in code, a quoted label, and ordinary prose.
Do not apply broad search-and-replace to repair language.

## Review messages and docs differently

**UI messages:** inspect the component and state that uses the key. Distinguish a button action,
loading state, completion notice, empty state, and error. Match space and punctuation conventions
for that surface. Preserve interpolation and ICU selectors; check zero, one, and multiple items,
as well as grammatical agreement around substituted names. Never translate placeholder names.
Preview changed controls for clipping, wrapping, accessible names, and focus behavior.

**Documentation:** read each translated section without looking at the English. Does it sound like
native instructions, and could the reader complete the task? Then compare against the source for
omissions, additions, altered conditions, and misleading claims. Check title, description, search
terms, alt text, captions, component attributes, localized link prefixes, and translated anchors.
Shared English screenshots do not license English control names in localized instructions.

For substantial rewrites, use an independent locale review when available. Give the reviewer the
reader's task and the draft; ask for meaning, flow, terminology, and usability findings, not a
literal back-translation. Resolve findings and track pages actually reviewed.

## Verify and hand off

Run applicable locale/key/ICU and docs checks, then inspect the rendered result. Review report-mode
findings as well as failures. Fix factual or grammatical defects; document a narrow exception only
when a check is wrong for the context. Never weaken parity to make an unfinished translation pass.

The handoff states which locales and surfaces changed, the observed flows and checks, and remaining
uncertainty. A fluent-looking page and a green suite do not establish native quality on their own.

For new locales, see [GLOSSARY_GUIDE.md](GLOSSARY_GUIDE.md#adding-a-locale).
This workflow follows [Microsoft's global communication guidance](https://learn.microsoft.com/en-us/style-guide/global-communications/)
while retaining Tale's own informal voice and product terminology.
