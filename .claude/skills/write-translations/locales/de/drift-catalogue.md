# DE — drift catalogue

Named bureaucratic-drift patterns. Each has a regex form in [`packages/ui/src/i18n/tests/locales/de/voice.ts`](../../../../../packages/ui/src/i18n/tests/locales/de/voice.ts) or a calque in the same file's `calques` array. Reviewers cover the rest.

## 1. Passive present — `Wird X…`

**Pattern.** Whole-value string of the shape `Wird <participle>` optionally followed by `…` or `...`.

**Example drift.** `"Wird gespeichert..."`, `"Wird ausgeführt..."`, `"Wird importiert..."`.

**Target.** Active form: `"Speichert..."`, `"Führt aus..."`, `"Importiert..."`.

**Why.** Passive present hides the agent (the system) and adds characters the UI doesn't have room for. Active forms read native and shorter.

**Carve-out.** Legitimate declarative passive — `"Wird verwendet, wenn der Standardmodus Sperrliste ist."` — passes the value-shape regex (`^Wird\s+\w+[\s.…!?]*$`) because the value contains additional clauses.

## 2. Sentence-final `erfolgreich`

**Pattern.** `<noun/object> erfolgreich <past-participle>` at end of sentence.

**Example drift.** `"Mitglied erfolgreich aktualisiert."`, `"Datei erfolgreich hochgeladen."`.

**Target.** Drop `erfolgreich`: `"Mitglied aktualisiert."`, `"Datei hochgeladen."`.

**Why.** The toast is the success signal; the adverb is redundant. Native German UI prose names the outcome, not the success of the outcome.

## 3. `Damit` sentence opener

**Pattern.** `^Damit \w+` at line start (sentence start in prose).

**Example drift.** _Damit werden Agents, Workflows und Anbieter entfernt._

**Target.** Verb-first: _Entfernt Agents, Workflows und Anbieter._ — or restructure entirely.

**Why.** `Damit` opener is a translator's tic — a structural carry-over from English clauses that read more native as verb-first in German. Mid-sentence `damit` (subordinate clause) is fine; the rule fires only at line start.

## 4. Compound stacking (4+ roots)

**Heuristic.** Single-word compound longer than 25 characters surfaces for review.

**Example drift.** _Organisationsmitgliederzugriffsverwaltung_.

**Target.** Break into a noun phrase: _Zugriff auf die Mitglieder der Organisation verwalten_.

**Why.** German's strength is 2–3-root compounds. Beyond three, the reader parses one word as a paragraph; the noun-phrase form is faster.

**Not regex-enforced** — the heuristic surfaces candidates; reviewers decide.

## 5. Calques

**Pattern.** Closed list of literal English-to-German renderings that lose meaning.

| Drift                                     | Target                                                    |
| ----------------------------------------- | --------------------------------------------------------- |
| `Vertrauenshaltung` (for "trust posture") | name the actual certifications (ISO 27001, SOC 2 Type II) |
| `Nutzerreise` (for "user journey")        | `Ablauf` or `Nutzerablauf`                                |
| `Operationsfläche` (for "surface area")   | `Oberfläche`                                              |
| `in der Schleife` (for "in the loop")     | `eingebunden`                                             |
| `aus der Box` (for "out of the box")      | `sofort einsatzbereit`                                    |

Caught either by regex (the `in der Schleife` / `aus der Box` patterns are denylisted in `voice.ts`) or by review.

## 6. Half-translated compounds

Covered in [`../../BUCKETS.md`](../../BUCKETS.md) § "DE half-compounds" and enforced by `terminology-half-compound`. The mapping is regex-based in [`packages/ui/src/i18n/tests/locales/de/terminology.ts`](../../../../../packages/ui/src/i18n/tests/locales/de/terminology.ts).

## 7. Gender slips

Caught by `grammar-articles` against the 51-noun closed list in [`packages/ui/src/i18n/tests/locales/de/grammar.ts`](../../../../../packages/ui/src/i18n/tests/locales/de/grammar.ts). Examples: `einen Anfrage` → `eine Anfrage` (`Anfrage` is feminine); `dem Anfrage` → `der Anfrage`. Outside the closed list, reviewers cover gender disagreements.

## 8. Sie-slips

Caught by `pronouns-formal`. Carve-out: sentence-initial `Sie` (third-person feminine/plural ambiguity) is allowed.

## When you find a new pattern

Document the drift here with one paragraph, one example, and one target. If it has a regex form, add to [`packages/ui/src/i18n/tests/locales/de/voice.ts`](../../../../../packages/ui/src/i18n/tests/locales/de/voice.ts) under `DRIFT`; if it's a calque, add to `calques`. Add a planted fixture under [`packages/ui/src/i18n/tests/locales/de/planted/voice-drift/`](../../../../../packages/ui/src/i18n/tests/locales/de/planted/voice-drift/).
