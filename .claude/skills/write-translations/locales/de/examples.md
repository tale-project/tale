# DE — examples

Three positive examples and three drift→target pairs.

## Positive — a correct translation that doesn't translate one thing

**English source.** _Open a pull request from your feature branch. The CI pipeline runs against the head of the branch; the merge into `main` is gated on green._

**German target.** _Öffne einen Pull Request aus deinem Feature-Branch. Die CI-Pipeline läuft gegen den Kopf des Branches; der Merge in `main` ist erst möglich, wenn die Pipeline grün ist._

**Why this works.** `Pull Request`, `Feature-Branch`, `CI`, `Pipeline`, `Merge`, `Branch` all stay English (bucket 2 + 2a). `der Kopf des Branches` reads naturally in German for "the head of the branch". `du`, never `Sie`. No `erfolgreich`, no `Wird X…`. The English-kept terms aren't lazy translation — they're the words a German-speaking developer uses without thinking.

## Positive — concept page opening

**English source.** _An agent is a bundle of four things: instructions, knowledge, tools, and a model. The instructions say what the agent does; the knowledge says what it reads; the tools say what it can call; the model says how it thinks. Most agents end up on Standard. Reach for Pro when the agent runs against a 200 K token context or invokes more than three custom tools per turn._

**German target.** _Ein Agent ist ein Bündel aus vier Dingen: Anweisungen, Wissensdatenbank, Tools und ein Modell. Die Anweisungen sagen, was der Agent tut; die Wissensdatenbank sagt, was er liest; die Tools sagen, was er aufrufen kann; das Modell sagt, wie er denkt. Die meisten Agents landen auf Standard. Greife zu Pro, wenn der Agent gegen einen 200 K Token Kontext läuft oder mehr als drei eigene Tools pro Turn aufruft._

**Why this works.** Bucket-2 terms stay English (`Agent`, `Tools`, `Modell`, `Standard`, `Pro`, `Token`, `Kontext`, `Turn`). Bucket-3 translate-bucket: `Wissensdatenbank` (compound translated whole, not `Knowledge-Datenbank`). `du` form (`Greife`). Verb-first imperative reads native.

## Positive — UI walkthrough, effect-first

**English source.** _To restrict an agent's knowledge to one folder, open the agent's **Knowledge** tab and pick the folder under **Sources**._

**German target.** _Um das Wissen eines Agents auf einen Ordner zu beschränken, öffne die **Wissensdatenbank**-Registerkarte des Agents und wähle den Ordner unter **Quellen**._

**Why this works.** Effect-first phrasing — outcome before the click. The UI labels (`Wissensdatenbank`, `Quellen`) match what the shipped UI displays for that locale; the writer pulled them from `services/platform/messages/de.yml`. `du` (`öffne`, `wähle`). No `Sie`, no `Wird`.

## Drift → target #1 — the Wird pattern

**Drift, from `services/platform/messages/de.yml:1272`.** `"importing": "Wird importiert..."`

**Target.** `"importing": "Importiert…"`

**Why.** The `Wird …` passive-present pattern hides the agent (the system) and adds three characters the UI doesn't have room for. Active forms are the bar: `Lädt…`, `Speichert…`, `Importiert…`, `Sendet…`. Caught by `voice-drift` in [`packages/ui/src/i18n/tests/locales/de/voice.ts`](../../../../../packages/ui/src/i18n/tests/locales/de/voice.ts).

## Drift → target #2 — `erfolgreich` redundancy

**Drift.** _Mitglied erfolgreich aktualisiert._

**Target.** _Mitglied aktualisiert._

**Why.** The toast itself is the success signal; `erfolgreich` is redundant. When the toast appears, the action succeeded — that's why the toast is there. Adding `erfolgreich` reads as a translator-of-an-English-confirmation, not as native German UI prose.

## Drift → target #3 — bucket choice for an ambiguous term

**Question.** Is `Header` an established loanword (keep English in DE) or a translate-bucket noun (must translate)?

**Answer.** The bucket assignment is on the term entry in [`packages/ui/src/i18n/tests/glossary/glossary.yml`](../../../../../packages/ui/src/i18n/tests/glossary/glossary.yml). Today, `Header` is in the translate-bucket — it renders as `Kopfzeile` in DE and `En-tête` in FR. The test rejects the English form in DE/FR prose. To move it, edit the term entry; the test flips on the next run. You don't edit this skill.
