# Glossary workflow

The glossary lives at
[`packages/ui/src/i18n/tests/glossary/glossary.yml`](../../../packages/ui/src/i18n/tests/glossary/glossary.yml).
It is test data, not human-facing documentation — Claude and the tests read it; the doctrine files
reference it.

## Adding a term

Append to `terms`:

```yaml
- key: MyNewFeature
  category: feature
  en: MyNewFeature
  de: MeineNeueFunktion
  fr: MaNouvelleFonction
  _note: feature shipped 2026-Q2
```

Required: `key`, `category`, `en`. Locale fields (`de`, `fr`, `de_CH`) are optional — omit them when
the term stays English in that locale (loanwords, brands).

## Choosing a category

Decide the bucket ([BUCKETS.md](BUCKETS.md)), then pick the matching category:

| Bucket                | Categories                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- |
| Always English        | `brand`, `acronym`, `codeIdentifier`, `abbreviation`                                    |
| Established loanwords | `loanword`, `gitDomain`                                                                 |
| Translate-bucket      | `translateBucket`                                                                       |
| Translate by default  | `feature`, `role`, `knowledgeEntity`, `technicalVocab`, `actionVerb`, `deploymentVocab` |

The "translate by default" categories cover product vocabulary with a natural target-language form.
Whether the tests enforce the translation depends on the locale form differing from EN —
`loadGlossary().shouldEnforce(term, locale)` returns false when the forms match.

## The `_lintExclude` field

When the UI ships English for a term the bucket says should translate (a deferred fix, a deliberate
carve-out), exclude that locale:

```yaml
- key: FooBar
  category: translateBucket
  en: FooBar
  de: Eigenes-FooBar
  _lintExclude:
    de: true
  _note: shipping the EN form until the FooBar redesign lands (Q3 2026); flip de to false then
```

`shouldEnforce` honours `_lintExclude`. Every `true` is a deliberate decision; a `_note` explaining the
deferral is required at review.

## When the UI and the glossary disagree

The shipped UI string wins. Update the glossary in the same PR that updates the UI; the
`terminology-ui-label` and `terminology-loanword` checks catch the divergence on the next run. Old
forms remain valid only via `_lintExclude` with a dated `_note` planning the cleanup.

## Role names

Roles ship per locale (`category: "role"`):

| EN        | DE          | FR           |
| --------- | ----------- | ------------ |
| Owner     | Inhaber     | Propriétaire |
| Admin     | Admin       | Admin        |
| Developer | Entwickler  | Développeur  |
| Editor    | Redakteur   | Éditeur      |
| Member    | Mitglied    | Membre       |
| Disabled  | Deaktiviert | Désactivé    |

`Admin` stays English in DE/FR (no locale field). `Disabled` is rare — a disabled account can't access
Tale; the term appears mostly in admin-page member tables.

## The audit script

A non-test utility at
[`services/docs/scripts/glossary-audit.ts`](../../../services/docs/scripts/glossary-audit.ts)
cross-references the glossary against `services/platform/messages/*.yml` and writes three reports to
`services/docs/scripts/audit-output/`:

- `stale-glossary.md` — entries whose declared locale form has zero hits in the shipped UI.
- `ui-string-leaks.md` — DE/FR UI strings carrying the English form of a `translateBucket` entry
  (platform-UI bugs the docs tests can't fix).
- `missing-from-glossary.md` — frequent capitalised English words not in the glossary (candidates for
  new entries).

Run: `bun services/docs/scripts/glossary-audit.ts`.
