# German (de) terminology

German base locale for the platform UI (`services/platform/messages/de.json`), the marketing site (`services/web/messages/de.json`), and the docs site (`docs/de/` page bodies plus `services/docs/messages/de.json` chrome strings). Cross-locale rules — voice, the loanword policy, length, plurals, placeholders — live in [`TERMINOLOGY.md`](TERMINOLOGY.md); read that file first. English source forms and the EN-specific doctrine live in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md).

Regional variants extend this file with deltas only:

- [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md) — Swiss German

This file is **doctrine only**: voice rules, anti-pattern descriptions, principles. Every concrete word list — product features, knowledge-base entities, technical vocabulary, action verbs, deployment vocabulary, Git-domain loanwords, role names, marketing softeners, drift→target examples, toast and error patterns, abbreviations, noun genders — lives in [`GLOSSARY.json`](GLOSSARY.json). When this file and the glossary disagree, the glossary wins for words; this file wins for rules.

---

## 1 · The German voice — what it is, what it isn't

German translation that preserves vocabulary but loses voice is still wrong. Tale's German narrator is the same calm, opinionated, second-person-informal voice as the English one — not a translator's careful neutral.

### Five rules the voice always respects

**1. `du`, never `Sie`.** The informal form is used consistently across UI, marketing, and docs. Inflections (`dein`, `deine`, `dir`) follow. Enforced by [`terminology.test.ts`](../../services/docs/tests/terminology.test.ts).

**2. Active verbs in present tense.** UI feedback messages have an obvious agent (the system) and benefit from the active form. The drift→target pairs for passive-present construction live at `antiPatternExamples.de.passivePresent` in [`GLOSSARY.json`](GLOSSARY.json).

**3. Imperative for instructions.** `Führe tale deploy aus` — not `Du kannst tale deploy ausführen`, not `Bitte führe tale deploy aus`. The reader didn't ask for permission.

**4. Why before what.** Same as English. `Führe tale deploy aus — das stösst einen Blue-Green-Rollout an, der den alten Container weiterserve, bis der neue seine Health-Checks besteht.`

**5. Same words across the corpus.** When two German nouns mean roughly the same thing, the glossary names which one Tale uses (`Website` over `Webseite`, `Nutzer` over `Benutzer`, `Konversation` over `Unterhaltung`, `E-Mail` over `Email`, `Anmelden` over `Einloggen`). The canonical forms live across `productVocabulary.*` in [`GLOSSARY.json`](GLOSSARY.json).

### Marketing softeners — strike on sight

The closed list of German marketing softeners lives at `marketingSofteners.de` in [`GLOSSARY.json`](GLOSSARY.json). When you reach for one of them, delete it instead and let the demonstration carry the claim.

---

## 2 · The bureaucracy drift — anti-pattern catalogue

These are the patterns German translators reach for under deadline pressure. None of them lands Tale's voice. The drift→target examples for each pattern live in [`GLOSSARY.json`](GLOSSARY.json) under `antiPatternExamples.de.<patternKey>`.

### Anti-pattern 1 · Passive present (`Wird X…`)

Passive present (`Wird gespeichert…`, `Wird geladen…`) hides the agent (the system) and adds three characters. Use the active form (`Speichert…`, `Lädt…`). The full drift table is at `antiPatternExamples.de.passivePresent`.

The passive `werden` form is legitimate when the agent is genuinely unknown or irrelevant — system errors not caused by the user, for example. For UI feedback messages, the active form is the bar.

### Anti-pattern 2 · Sentence-final adverbs (`erfolgreich`)

Strike `erfolgreich` from every confirmation toast — the toast is the success signal; the adverb is redundant. Keep it only when the page contrasts success and failure cases explicitly (`erfolgreich abgeschlossen vs. fehlgeschlagen`). Drift→target pairs at `antiPatternExamples.de.erfolgreichSuffix`.

### Anti-pattern 3 · `Damit` as a sentence opener

`Damit` is grammatically correct German but it's a translator's tic. The simpler verb-first construction reads native. Examples at `antiPatternExamples.de.damitOpener`.

### Anti-pattern 4 · Compound stacking

German loves compound nouns — but four-root compounds are a smell. Two-root compounds (`Wissensdatenbank`, `Arbeitsbereich`) are German's strength. Three-root compounds are still fine when one root is an English loanword or abbreviation (`MCP-Server-Adresse`, `API-Schlüssel-Rotation`). Four-root stacks should be split. Examples at `antiPatternExamples.de.compoundStack`.

### Anti-pattern 5 · Calqued English idioms

When the English uses an abstract noun (`story`, `journey`, `posture`, `surface`), translate the **meaning**, not the noun. A literal calque produces sentences a native German reader rejects. Examples at `antiPatternExamples.de.calquedIdioms`.

### Anti-pattern 6 · The English word in the middle of a German sentence

Caught (in part) by [`loanword.test.ts`](../../services/docs/tests/loanword.test.ts) for Bucket 3 terms. The drift table lives at `antiPatternExamples.de.englishMidSentence`; the canonical native forms are at `translateBucket.de` in the glossary.

### Anti-pattern 7 · Sie-Slips

Most common at sentence starts after a colon, where `Sie` _can_ be the third-person plural pronoun referring to a previous noun. Avoid the construction even when grammatically third-person, because the lint flags it. Drift→target pairs at `antiPatternExamples.de.sieSlips`.

### Anti-pattern 8 · Lazy capitalisation

German capitalises all nouns; acronyms stay uppercase; product names follow their canonical form. The drift table is at `antiPatternExamples.de.lazyCapitalisation`.

### Anti-pattern 9 · Half-translated compound

A multi-word technical term split across languages: `Pull Anfrage`, `Code Review-Prozess`, `Merge-Anfrage`, `Branch-Zweig`, `Knowledge-Datenbank`. Compound terms are translated whole or kept whole, never half. Examples at `antiPatternExamples.de.halfTranslatedCompound`; see the no-half-translation rule in [`TERMINOLOGY.md`](TERMINOLOGY.md).

### Anti-pattern 10 · Gender slip

A masculine article on a feminine noun (`einen einmaligen Warnung` — should be `eine einmalige Warnung`), a dative-masculine on a feminine noun (`dem Anfrage` — should be `der Anfrage`), and the rest of the class. Caught (warn-only) by [`grammar-de.test.ts`](../../services/docs/tests/grammar-de.test.ts) for the closed list of high-frequency Tale nouns. The noun-gender map lives at `nounGenders.de` in [`GLOSSARY.json`](GLOSSARY.json); examples at `antiPatternExamples.de.genderSlip`.

---

## 3 · Product vocabulary

Every concrete German term lives in [`GLOSSARY.json`](GLOSSARY.json):

- **`productVocabulary.features`** — Agent, Workflow, Knowledge base, Canvas, Composer, Approvals, Audit log, MCP server, Changelog, Data subject request, etc.
- **`productVocabulary.knowledgeEntities`** — Website, Customer, Vendor, Product, Document, Folder.
- **`productVocabulary.technicalVocab`** — API, LLM, Token, Prompt, Webhook, Provider/Anbieter, PII, MCP server, API key, etc.
- **`productVocabulary.actionVerbs`** — Save/Speichern, Delete/Löschen, Edit/Bearbeiten, …
- **`productVocabulary.deploymentVocab`** — Self-hosted / selbst gehostet, On-premises, Open Source, Zero-Downtime, Blue-Green, Docker Compose, Team, etc.
- **`gitDomainLoanwords.de`** — Pull Request, Merge, Rebase, Branch, Commit, Push, Pull, Fork, Diff, Code Review, Issue, Repository, Tag, Release. These stay English; half-translated forms fail review.
- **`roleNames.matrix`** — the canonical Inhaber / Admin / Entwickler / Redakteur / Mitglied / Deaktiviert mapping.

The rules that govern those entries:

- **Match the shipped UI verbatim.** Before quoting a button or menu, grep `services/platform/messages/de.json`. When the UI and the glossary disagree, update the UI first, then the glossary, in the same PR.
- **Capitalise when naming the role**; lowercase when the word is purely generic and matches the everyday German noun (`die Mitglieder deines Teams`).
- **The lint enforces role mappings for Owner, Developer, Member/Members, and Disabled.** Editor is not enforced by lint because the same English word also appears as a UI loanword for the visual workflow editor and IDE editors (`Workflow-Editor`, `KI-Editor`); translate the role-context occurrences to **Redakteur** by hand.
- **Bucket 3 terms must translate.** `Header → Kopfzeile`, `Request → Anfrage`, `Provider → Anbieter`, `Email → E-Mail`, `Help Center → Hilfe-Center`, `Billing → Abrechnung`, `Sales Research → Vertriebs-Recherche`, `Draft → Entwurf`, `Attachment → Anhang`, `Self-hosted → selbst gehostet`. The full list and rationales live at `translateBucket.de`.

---

## 4 · Toasts and error messages

Toast confirmations use past participle, no period, the noun first; `erfolgreich` is never included. Pattern and examples at `toastConventions.de` in [`GLOSSARY.json`](GLOSSARY.json).

Error messages name what happened and what to do next, one sentence ending with a period, never blaming the reader. Per-pattern translations at `errorMessagePatterns`.

---

## 5 · Style rules

- **`du`, never `Sie`.** Across UI, marketing, and docs.
- **Compound nouns follow standard German rules.** Hyphenate when a component is an English loanword, an abbreviation, or when the hyphen improves readability: `API-Schlüssel`, `E-Mail-Anbieter`, `Docker-Service`, `JSON-Datei`.
- **Quotation marks:** `„Text"` (low-9 opening, high-9 closing) in running prose. Straight `"..."` inside UI labels and code blocks.
- **Apostrophes:** straight ASCII `'` everywhere. German prose rarely needs an apostrophe.
- **Decimal comma** in docs prose (`2,5 GB`). Inside code blocks and env var values, keep the period (`2.5`).
- **Thousands separator:** period or narrow space (`1.000` or `1 000`).
- **Dates:** `DD.MM.YYYY` in docs prose (`19.04.2026`). In frontmatter and technical contexts, use ISO (`2026-04-19`).
- **Times:** 24-hour clock (`09:00`, `17:30`).
- **Gerunds:** avoid English `-ing` forms dropped untranslated. `Logging` → `Protokollierung`. Keep `Monitoring` only when it refers to a specific tool category.
- **Headings are sentence case.** `## Agent-Konzepte`, not `## Agent-Konzepte In Tale`.
- **UI labels must match the product.** Before quoting a button or menu, grep `services/platform/messages/de.json`.
- **`ss` vs `ß` — strict per locale.** Base German (`de/`) uses `ß` after long vowels and diphthongs (`Straße`, `groß`, `Schließen`, `gemäß`, `Standardmäßig`, `heißen`, `weiß`). Swiss German (`de-CH/`) uses `ss` exclusively. **Mixing the two in the same locale is a bug.** Common offenders: `Standardmäßig`/`Standardmässig`, `gemäß`/`gemäss`, `schließen`/`schliessen`, `groß`/`gross`. Before committing a DE page, grep for `ss` next to vowels and convert to `ß` where the rule applies; for DE-CH, do the reverse.

The machine-readable form of these conventions lives at `styleConventions.de` in [`GLOSSARY.json`](GLOSSARY.json).
