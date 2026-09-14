# French review patterns

Read in context. The actual configured patterns live in
[voice data](../../../../../packages/ui/src/i18n/tests/locales/fr/voice.ts) and
[terminology data](../../../../../packages/ui/src/i18n/tests/locales/fr/terminology.ts).

## Marketing language

Invitations such as “Découvre” and “N’hésite pas à” often delay the useful instruction. Replace
promotional language with the action or a verified result. Do not invent indexing times, model
capabilities, or certifications to make the revision sound concrete.

## English-shaped sentences

Check noun chains, ambiguous pronouns, literal metaphors, and unexplained English words. Rewrite
with ordinary French verbs or relative clauses while keeping conditions and scope intact. A
loanword can be correct; English word order around it may still be wrong.

## Address and modality

Use `tu` and its possessives for Tale's reader. Distinguish an optional “Tu peux…” from a required
imperative; making every sentence verb-first can change the source meaning.

## Typography and labels

Docs prose uses typographic apostrophes and configured nonbreaking spaces. Code and exact UI
labels preserve their own syntax. Apply [CONVENTIONS.md](../../CONVENTIONS.md) according to the
surface instead of replacing every apostrophe in a file.

## Adding a guard

A recurring pattern needs real examples and counterexamples. Add a narrowly scoped check only
when it reliably distinguishes them, with positive and negative fixtures. Native fluency and
factual equivalence still require review.
