# Decide what to translate

The canonical assignments live in
[glossary.yml](../../../packages/ui/src/i18n/tests/glossary/glossary.yml). This file explains how
to use them; it does not maintain a second word list.

## First identify the context

An exact code identifier, a quoted UI label, and an ordinary word have different requirements.
For example, `Authorization` in an HTTP request must stay byte-for-byte, while a sentence explaining
request authorization needs native prose. Use the shipped catalog for a control's name. Do not
change it to a preferred dictionary term and make the interface harder to follow.

## The glossary categories

| Kind | Categories | Treatment |
| --- | --- | --- |
| Stable identifiers | `brand`, `acronym`, `codeIdentifier`, `abbreviation` | Preserve the specified token; explain unfamiliar abbreviations when the audience needs it. |
| Established loanwords | `loanword`, `gitDomain` | Use the approved form in that domain and locale; fit it into native grammar. |
| Required translation | `translateBucket` | Use the recorded locale form unless a scoped glossary exception applies. |
| Product and ordinary vocabulary | `feature`, `role`, `knowledgeEntity`, `technicalVocab`, `actionVerb`, `deploymentVocab` | Use the current locale form in context; quoted UI labels still follow the shipped catalog. |

Check the actual term entry, including locale overrides and `_note`. The category alone does not
justify preserving every English use of a word. An industry term suitable for an API integrator
may need a brief explanation for a first-time product user.

## Compounds and grammar

Translate a compound as a unit or retain the established unit. Avoid hybrids such as
`Knowledge-Datenbank` or `Pull Demande`. German compounds with accepted technical tokens may need
hyphens, such as `API-Schlüssel`. French surrounding prose needs normal articles, agreement,
prepositions, and plural forms; a loanword is not an excuse to reproduce English word order.

The testable patterns live in
[locale terminology data](../../../packages/ui/src/i18n/tests/locales/). Check their scope before
extending a denylist: a short pattern can reject legitimate language outside its intended domain.
Add realistic positive and negative fixtures for a new enforced rule.

## Resolve disagreement

Read the glossary entry, its notes, nearby native text, and the actual UI before choosing. If a
term has two meanings, document the distinction instead of applying a global replacement. If the
UI and glossary conflict, keep docs findable against the shipped UI while correcting the owner
within the authorized task. A deferred mismatch needs a narrow, explained exception following
[GLOSSARY_GUIDE.md](GLOSSARY_GUIDE.md), not an untracked synonym.
