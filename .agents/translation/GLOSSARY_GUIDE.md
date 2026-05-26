# Glossary workflow

The glossary lives at [`packages/ui/src/i18n/tests/glossary/glossary.json`](../../packages/ui/src/i18n/tests/glossary/glossary.json). It is test data, not human-facing documentation — Claude and the tests read it; the doctrine files reference it.

## Adding a term

Open `glossary.json` and append a new entry to `terms`:

```json
{
  "key": "MyNewFeature",
  "category": "feature",
  "en": "MyNewFeature",
  "de": "MeineNeueFunktion",
  "fr": "MaNouvelleFonction",
  "_note": "feature shipped 2026-Q2"
}
```

Required fields: `key`, `category`, `en`. Locale fields (`de`, `fr`, `de_CH`) are optional — omit when the term stays English in that locale (loanwords, brands).

## Choosing a category

Decide which bucket the term belongs to (see [BUCKETS.md](BUCKETS.md)), then pick the matching category:

| Bucket                | Categories                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- |
| Always English        | `brand`, `acronym`, `codeIdentifier`, `abbreviation`                                    |
| Established loanwords | `loanword`, `gitDomain`                                                                 |
| Translate-bucket      | `translateBucket`                                                                       |
| Translate by default  | `feature`, `role`, `knowledgeEntity`, `technicalVocab`, `actionVerb`, `deploymentVocab` |

The four "translate by default" categories cover product vocabulary that has a natural target-language form. Whether the tests enforce the translation depends on the locale form differing from the EN form — `loadGlossary().shouldEnforce(term, locale)` returns false when the forms match.

## The `_lintExclude` field

When the UI ships English for a term that the bucket says should translate (a deferred fix, a deliberate carve-out), the entry gets `_lintExclude` for the affected locale:

```json
{
  "key": "FooBar",
  "category": "translateBucket",
  "en": "FooBar",
  "de": "Eigenes-FooBar",
  "_lintExclude": { "de": true },
  "_note": "shipping the EN form until the FooBar redesign lands (Q3 2026); flip de to false then"
}
```

Every `true` in `_lintExclude` is a deliberate decision. A `_note` explaining the deferral is required at review time.

## When the UI and the glossary disagree

The shipped UI string wins. Update the glossary in the same PR that updates the UI; the tests catch the divergence on the next run.

## When a term changes form

A term's form can change between versions (a feature rename, a brand update). Update the glossary entry; the `terminology-ui-label` and `terminology-loanword` checks pick up the new form. Old forms remain valid only via `_lintExclude` with a dated `_note` planning the cleanup.

## Categories that translate roles

The role names ship per locale and are listed once per locale file:

| EN        | DE          | FR           |
| --------- | ----------- | ------------ |
| Owner     | Inhaber     | Propriétaire |
| Admin     | Admin       | Admin        |
| Developer | Entwickler  | Développeur  |
| Editor    | Redakteur   | Éditeur      |
| Member    | Mitglied    | Membre       |
| Disabled  | Deaktiviert | Désactivé    |

Disabled is rare — a disabled account cannot access Tale; the term appears mostly in admin-page member tables.

## The audit script

A non-test utility at [`services/docs/scripts/glossary-audit.ts`](../../services/docs/scripts/glossary-audit.ts) cross-references the glossary against `services/platform/messages/*.json` and writes three Markdown reports:

- `stale-glossary.md` — glossary entries whose declared locale form has zero hits in the shipped UI.
- `ui-string-leaks.md` — UI strings in DE/FR that contain the English form of a `translateBucket` glossary entry (platform-UI bugs the docs tests cannot fix).
- `missing-from-glossary.md` — frequent capitalised English words not in the glossary (candidates for new entries).

Run: `bun services/docs/scripts/glossary-audit.ts`. Reports land in `services/docs/scripts/audit-output/`.
