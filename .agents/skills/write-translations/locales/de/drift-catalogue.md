# German review patterns

Use these as diagnostic prompts. The actual enforced expressions live in
[voice data](../../../../../packages/ui/src/i18n/tests/locales/de/voice.ts) and
[terminology data](../../../../../packages/ui/src/i18n/tests/locales/de/terminology.ts).

## Bureaucratic phrasing

Watch for noun stacks and passive phrasing that hide the action. A short completion notice can say
“Datei gespeichert.” An explanatory sentence may legitimately use passive voice when the actor
is irrelevant. Do not turn a preference for clear actors into a ban on German grammar.

## Literal metaphors

A phrase such as “gegen den Kopf des Branches” carries English structure into German. State the
actual technical relationship instead, using the context and approved terms. For claims about
security or trust, describe the verified control; never invent certifications as an alternative
phrase.

## Repetitive connectors

Repeated “Damit…” or “Um… zu…” openings can flatten prose. Remove repetition when the purpose is
already clear. These constructions can also be correct and useful; inspect what the sentence
means before rewriting it.

## Grammar and address

Check case, gender, agreement, pronoun references, and informal address. `einen Anfrage` needs
`eine Anfrage`; a sentence-initial `Sie` may refer to a third-person subject rather than formally
address the reader. A small regex word list does not cover every grammatical dependency.

## Adding a guard

Record the actual defect and examples that should remain valid. Add a scoped pattern only when it
can distinguish them reliably, with positive and negative fixtures in the locale's test data.
Use editorial review for broad questions of rhythm, readability, and idiom.
