# French voice

Read [the shared workflow](../../SKILL.md). Use natural written French with informal `tu`. The
voice is calm and helpful. Avoid both advertising language and terse fragments that sound like
machine-translated labels.

## Natural instructions and explanations

Use direct imperatives for steps: `Ouvre`, `Choisis`, `Vérifie`. Explanations should flow as French
sentences; use relative clauses and clear pronoun references when they help. Do not reproduce
English noun chains or force “Pour…” onto every instruction. A condition must remain attached to
the action it qualifies.

Replace formal address with `tu`, `ton`, `ta`, and `tes` as appropriate. Keep quoted external
wording exact when the task calls for it. Avoid marketing invitations such as “Découvre”,
“N’hésite pas à”, and “Profite de”. Explain a concrete action or result instead, without adding
unverified timing or capability promises.

## Terms, labels, and typography

Use the resolved French message value for a visible control. Format it in bold; do not add
quotation marks inside the label unless the interface contains them. A UI label may retain an
English technical term; the surrounding sentence should still use idiomatic French.

Consult [BUCKETS.md](../../BUCKETS.md) and the glossary in context. Do not scatter English `tools`,
`server`, or `feature branch` through French prose by copying a generic loanword list. Resolve the
actual term and domain; ordinary explanatory text often needs a French phrase. Acronyms and code
identifiers remain exact.

Use `’` in prose, `« texte »`, and nonbreaking spaces according to
[CONVENTIONS.md](../../CONVENTIONS.md). Preserve ASCII syntax in code and catalog conventions in
quoted UI strings. Keep all factual currencies, units, numerical values, and jurisdictions.

## Review risks

Read the French draft independently, then compare source meaning. Check agreement, pronoun
references, article choice around loanwords, negation, conditional language, and omitted
qualifiers. Read [examples.md](examples.md), [drift-catalogue.md](drift-catalogue.md), or
[glossary-notes.md](glossary-notes.md) when relevant. The
[locale checks](../../../../../packages/ui/src/i18n/tests/locales/fr/) do not establish fluency.
