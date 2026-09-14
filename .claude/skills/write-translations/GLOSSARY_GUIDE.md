# Keep terminology consistent

The source of truth is
[glossary.yml](../../../packages/ui/src/i18n/tests/glossary/glossary.yml). Avoid copying its term
inventory or role table into this skill; those copies drift when the product changes.

## Adding or correcting a term

Find the concept and its current UI usage first. Determine whether the name is a brand, identifier,
loanword, translated product term, or ordinary vocabulary using [BUCKETS.md](BUCKETS.md). Inspect
nearby glossary entries and the loader schema, then add the smallest entry that expresses the
actual rule. Required fields are `key`, `category`, and `en`; locale fields are `de`, `fr`, and
`de_CH`. Omitted locale forms may mean the term stays English; check the category and fallback.

Use `_note` for context that affects a decision, such as a domain-specific meaning or a deliberate
UI exception. A new feature name needs its catalog keys and docs updated in every full locale.
Do not add every ordinary noun to the glossary or use an English token to avoid making a language
decision.

## UI disagreements and exceptions

A walkthrough must name the control the reader sees. If the glossary disagrees with the shipped
label, verify the intended owner and correct the catalog/glossary/docs together where authorized.
Use `_lintExclude` only for a specific locale and documented mismatch that cannot be resolved in
the current change. Explain why and what would remove the exception in `_note`; do not invent a
future date or promise a follow-up that has no owner.

A glossary exception does not exempt untranslated prose, missing ICU arguments, or factual drift.
Run the relevant terminology tests and inspect affected uses in context. Patterns for shared
terms need negative fixtures so a fix does not reject legitimate code or an unrelated meaning.

## Supporting notes

Read a locale's `glossary-notes.md` when it provides needed domain context. Put ordinary choices in
the canonical entry; use a companion note only when the explanation is too substantial for
`_note`. Test modes and current term forms belong in their implemented owners, not repeated tables.

The legacy `services/docs/scripts/glossary-audit.ts` can identify candidate mismatches, but writes
reports inside the clone and has no output-directory option. Prefer read-only searches for normal
work and record results in the global task note. Treat an unmatched glossary term as a lead to
investigate, not proof of incorrect translation: some terms occur only in docs.

## Adding a locale

Inspect the current runtime and test registries before editing. The work spans:

- `packages/ui/src/i18n/locales.ts`, locale fallback behavior, service catalogs, and docs routing.
- The corresponding `packages/ui/src/i18n/tests/locales/<locale>/` style, voice, terminology,
  grammar, and pattern data, plus planted fixtures and registration.
- Full translated content and navigation labels, unless the locale is explicitly a regional
  overlay; key and page parity remain required for base locales.
- A locale guide in this skill and updates to its entrypoint links.

Verify fallback, plural forms, formatting, rendered layouts, links, and search in the new locale.
Do not infer jurisdiction, billing currency, or access rights from the language code.
