# German voice

Read [the shared workflow](../../SKILL.md). Use standard written German and informal `du`. The
reader should hear someone explaining a familiar product, not an English text transferred into
German grammar.

## Natural instructions and explanations

Use concrete verbs and ordinary German sentence order. `Öffne`, `Wähle`, and `Prüfe` work for
instructions; explanations do not all need imperative verbs. Place a condition where its scope is
clear. Divide a long sentence when the reader would have to retain several qualifications, but
keep connected ideas together.

Prefer native phrases over literal metaphors such as “gegen den Kopf des Branches laufen”. Do
not describe an agent as “gegen einen Kontext laufen” or promote a fabricated model tier to make
an example sound technical. Translate meaning and verify product claims separately.

Use `du`, `dein`, and their inflections when addressing the reader. Third-person `sie` remains
ordinary German; do not mechanically replace every occurrence. Avoid bureaucratic noun stacks
and redundant success adjectives. Passive voice can be appropriate when the actor is unknown or
irrelevant; a short UI progress label has different needs from a full explanatory sentence.

## Terms, labels, and typography

Read [BUCKETS.md](../../BUCKETS.md) for the glossary decision. Use exact German UI labels, including
role names and each segment of a navigation path. Outside quoted labels, nouns and loanwords
still require correct case, gender, articles, and plural forms. Use established compounds and
hyphenate technical combinations where needed, such as `API-Schlüssel`.

Use standard German `ß`, `„Text“` in prose, decimal commas, and the formats in
[CONVENTIONS.md](../../CONVENTIONS.md). Message values and code retain their own conventions.
Never turn a USD price into EUR or replace a legal jurisdiction during translation.

## Review risks

Check clumsy nominal phrases, ambiguous pronouns, accidental formal address, and literal English
idioms. Read [drift-catalogue.md](drift-catalogue.md) when diagnosing a recurring pattern and
[examples.md](examples.md) for native alternatives. The
[locale test data](../../../../../packages/ui/src/i18n/tests/locales/de/) catches selected
patterns; a passing sentence can still sound unnatural or change a condition.

Read [glossary-notes.md](glossary-notes.md) when terminology needs more context.
