# German (de) terminology

German base locale for the platform UI (`services/platform/messages/de.json`), the marketing site (`services/web/messages/de.json`), and the docs site (`docs/de/` page bodies plus `services/docs/messages/de.json` chrome strings). Cross-locale rules — voice, the loanword policy, length, plurals, placeholders — live in [`TERMINOLOGY.md`](TERMINOLOGY.md); read that file first. English source forms and the EN-specific doctrine live in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md).

Regional variants extend this file with deltas only:

- [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md) — Swiss German

**Where things live.** Doctrine + illustrative drift→target tables live in this file. Term lookups live in [`GLOSSARY.json`](GLOSSARY.json) `terms[]` (filter by `category` and check the `de` field). Test-data lists (formal pronouns, noun-gender map) live in [`services/docs/tests/data/`](../../services/docs/tests/data/).

---

## 1 · The German voice — what it is, what it isn't

German translation that preserves vocabulary but loses voice is still wrong. Tale's German narrator is the same calm, opinionated, second-person-informal voice as the English one — not a translator's careful neutral.

### Five rules the voice always respects

**1. `du`, never `Sie`.** The informal form is used consistently across UI, marketing, and docs. Inflections (`dein`, `deine`, `dir`) follow. Enforced by [`terminology-pronouns.test.ts`](../../services/docs/tests/terminology-pronouns.test.ts); the formal-pronoun denylist lives at [`services/docs/tests/data/formal-pronouns.ts`](../../services/docs/tests/data/formal-pronouns.ts).

**2. Active verbs in present tense.** `Speichert die Änderungen` not `Die Änderungen werden gespeichert`. UI feedback messages have an obvious agent (the system) and benefit from the active form.

**3. Imperative for instructions.** `Führe tale deploy aus` — not `Du kannst tale deploy ausführen`, not `Bitte führe tale deploy aus`. The reader didn't ask for permission.

**4. Why before what.** Same as English. `Führe tale deploy aus — das stösst einen Blue-Green-Rollout an, der den alten Container weiterserve, bis der neue seine Health-Checks besteht.`

**5. Same words across the corpus.** When two German nouns mean roughly the same thing, the glossary names which one Tale uses (`Website` over `Webseite`, `Nutzer` over `Benutzer`, `Konversation` over `Unterhaltung`, `E-Mail` over `Email`, `Anmelden` over `Einloggen`). The canonical forms live in [`GLOSSARY.json`](GLOSSARY.json) `terms[]`.

### Marketing softeners — strike on sight (DE)

| Strike DE form         | Replace with                                               |
| ---------------------- | ---------------------------------------------------------- |
| `einfach`              | (delete; the demonstration carries it)                     |
| `ganz einfach`         | (delete)                                                   |
| `mühelos`              | (delete)                                                   |
| `bequem`               | (delete or describe what makes it convenient)              |
| `praktisch`            | (delete)                                                   |
| `leistungsstark`       | (delete or replace with a concrete capability)             |
| `intuitiv`             | (delete; the screenshot shows it)                          |
| `nahtlos`              | (delete; describe the missing-step that makes it seamless) |
| `bitte`                | (delete; imperative does the work)                         |
| `Entdecke`             | (replace with `Lies`, `Öffne`, `Sieh dir … an`)            |
| `Erlebe`               | (delete or replace with the concrete action)               |
| `du wirst sehen, dass` | (delete; let the reader see)                               |

---

## 2 · The bureaucracy drift — anti-pattern catalogue

These are the patterns German translators reach for under deadline pressure. None of them lands Tale's voice; every one of them is a flagged smell at review.

### Anti-pattern 1 · Passive present (`Wird X…`)

| Drift                | Target                         | Why drift fails                                                         |
| -------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `Wird gespeichert…`  | `Speichert…`                   | Passive present hides the agent (the system) and adds three characters. |
| `Wird geladen…`      | `Lädt…`                        | Same.                                                                   |
| `Wird gelöscht…`     | `Lösche…` or `Löscht…`         | Same.                                                                   |
| `Wird hinzugefügt…`  | `Füge hinzu…` or `Fügt hinzu…` | Same.                                                                   |
| `Wird erstellt…`     | `Erstellt…`                    | Same.                                                                   |
| `Wird aktualisiert…` | `Aktualisiert…`                | Same.                                                                   |
| `Wird gesendet…`     | `Sende…`                       | Same.                                                                   |
| `Wird hochgeladen…`  | `Lade hoch…`                   | Same.                                                                   |
| `Wird verarbeitet…`  | `Verarbeite…`                  | Same.                                                                   |

The passive `werden` form is legitimate when the agent is genuinely unknown or irrelevant — system errors not caused by the user, for example. For UI feedback messages, the active form is the bar.

### Anti-pattern 2 · Sentence-final adverbs (`erfolgreich`)

| Drift                                   | Target                      | Why drift fails                                              |
| --------------------------------------- | --------------------------- | ------------------------------------------------------------ |
| `Mitglied erfolgreich aktualisiert`     | `Mitglied aktualisiert`     | The toast is the success signal; `erfolgreich` is redundant. |
| `Änderungen erfolgreich gespeichert`    | `Änderungen gespeichert`    | Same.                                                        |
| `Erfolgreich gelöscht`                  | `Gelöscht`                  | Same.                                                        |
| `Datei erfolgreich hochgeladen`         | `Datei hochgeladen`         | Same.                                                        |
| `Profil erfolgreich aktualisiert`       | `Profil aktualisiert`       | Same.                                                        |
| `{count} Elemente erfolgreich gelöscht` | `{count} Elemente gelöscht` | ICU passes through unchanged.                                |

Strike `erfolgreich` from every confirmation toast. Keep it only when the page contrasts success and failure cases explicitly (`erfolgreich abgeschlossen vs. fehlgeschlagen`).

### Anti-pattern 3 · `Damit` as a sentence opener

| Drift                                                   | Target                                               |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `Damit werden Agents, Workflows und Anbieter entfernt.` | `Entfernt Agents, Workflows und Anbieter.`           |
| `Damit kannst du die Konversation fortsetzen.`          | `So setzt du die Konversation fort.` or `Setzt du …` |

`Damit` is grammatically correct German but it's a translator's tic. The verb-first construction reads native.

### Anti-pattern 4 · Compound stacking

German loves compound nouns — but four-root compounds are a smell. Two-root compounds (`Wissensdatenbank`, `Arbeitsbereich`) are German's strength. Three-root compounds are still fine when one root is an English loanword or abbreviation (`MCP-Server-Adresse`, `API-Schlüssel-Rotation`). Four-root stacks should be split.

| Drift                                           | Target                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| `Organisationsmitgliederzugriffsverwaltung`     | `Zugriff auf die Mitglieder der Organisation verwalten`   |
| `Workflow-Schritt-Status-Aktualisierungs-Event` | `Statusänderung eines Workflow-Schritts` (or restructure) |
| `Kundendokumentablageverzeichnis`               | `Ablageverzeichnis für Kundendokumente`                   |

### Anti-pattern 5 · Calqued English idioms

When the English uses an abstract noun (`story`, `journey`, `posture`, `surface`), translate the **meaning**, not the noun.

| EN source                       | Calque (wrong)                              | Native (right)                                            |
| ------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `Published certification story` | `Veröffentlichte Zertifizierungsgeschichte` | `Veröffentlichte Zertifizierungen` or name them           |
| `Trust posture`                 | `Vertrauenshaltung`                         | `Unsere Zertifizierungen` (concrete) or `Sicherheitslage` |
| `Operational surface`           | `Operative Seite`                           | `Der Betrieb`                                             |
| `User journey`                  | `Nutzerreise`                               | `Ablauf` or `Nutzerablauf`                                |
| `Data story`                    | `Datengeschichte`                           | `Daten` or `Datenverlauf`                                 |
| `In the loop`                   | `In der Schleife`                           | `Eingebunden`                                             |
| `Out of the box`                | `Aus der Box`                               | `Sofort einsatzbereit`                                    |

### Anti-pattern 6 · English noun in the middle of a German sentence

Caught by [`terminology-loanword.test.ts`](../../services/docs/tests/terminology-loanword.test.ts) for the Bucket-3 set. The cross-locale doctrine is in [`TERMINOLOGY.md`](TERMINOLOGY.md) §2.

| Drift                                                   | Target                                                  |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `Öffne den Header der Tabelle.`                         | `Öffne die Kopfzeile der Tabelle.`                      |
| `Ein Beispiel-Workflow für Sales Research.`             | `Ein Beispiel-Workflow für die Vertriebs-Recherche.`    |
| `Schicke deinen Request an die API.`                    | `Schicke deine Anfrage an die API.`                     |
| `Konfiguriere den Email-Provider.`                      | `Konfiguriere den E-Mail-Anbieter.`                     |
| `Dieser Agent kümmert sich um Billing-Fragen.`          | `Dieser Agent kümmert sich um Abrechnungsfragen.`       |
| `Du kannst die Workflow als Self-hosted laufen lassen.` | `Du kannst den Workflow selbst gehostet laufen lassen.` |
| `Lade den Draft hoch.`                                  | `Lade den Entwurf hoch.`                                |
| `Hänge das Attachment an.`                              | `Hänge den Anhang an.`                                  |

### Anti-pattern 7 · Half-translated compound

A multi-word technical term split across languages. Compound terms are translated whole or kept whole, never half. See the no-half-translation rule in [`TERMINOLOGY.md`](TERMINOLOGY.md) §2-bis.

| Drift                 | Target                                    |
| --------------------- | ----------------------------------------- |
| `Pull Anfrage`        | `Pull Request` (keep whole English)       |
| `Code Review-Prozess` | `Code Review` (drop `-Prozess`)           |
| `Merge-Anfrage`       | `Pull Request` or rephrase                |
| `Branch-Zweig`        | `Branch`                                  |
| `Knowledge-Datenbank` | `Wissensdatenbank` (full native compound) |

### Anti-pattern 8 · Sie-Slips

Most common at sentence starts after a colon (`X: Sie halten…`), where `Sie` _can_ be the third-person plural pronoun referring to a previous noun. Avoid even when grammatically third-person, because the lint flags it.

| Drift                                      | Target                                                   |
| ------------------------------------------ | -------------------------------------------------------- |
| `Vier Entscheidungen: Sie halten überall.` | `Vier Entscheidungen — dieselben Knöpfe halten überall.` |
| `Bitte beachten Sie:`                      | `Beachte:` (or drop entirely)                            |
| `Wenden Sie sich an den Support.`          | `Wende dich an den Support.`                             |

### Anti-pattern 9 · Gender slip

A masculine article on a feminine noun (`einen einmaligen Warnung`), a dative-masculine on a feminine noun (`dem Anfrage`), and the rest of the class. Caught (hard-fail, after precision tightening) by [`grammar-de.test.ts`](../../services/docs/tests/grammar-de.test.ts) for the closed list of high-frequency Tale nouns. The noun-gender map lives at [`services/docs/tests/data/noun-genders-de.ts`](../../services/docs/tests/data/noun-genders-de.ts).

| Drift                      | Target                   | Why drift fails                                              |
| -------------------------- | ------------------------ | ------------------------------------------------------------ |
| `einen einmaligen Warnung` | `eine einmalige Warnung` | `Warnung` is feminine — `eine einmalige` (fem nom/acc).      |
| `dem Anfrage`              | `der Anfrage`            | `Anfrage` is feminine — `der` (dat fem) not `dem` (dat m/n). |
| `einen Konversation`       | `eine Konversation`      | `Konversation` is feminine.                                  |

### Anti-pattern 10 · Lazy capitalisation

| Drift             | Target                                                         |
| ----------------- | -------------------------------------------------------------- |
| `email`           | `E-Mail`                                                       |
| `pdf`             | `PDF`                                                          |
| `api`             | `API`                                                          |
| `self-Hosted`     | `selbst gehostet` (in prose) or `Self-Hosted` (as proper noun) |
| `selbst Gehostet` | `selbst gehostet`                                              |

---

## 3 · Product vocabulary

Every concrete German term lives as a flat entry in [`GLOSSARY.json`](GLOSSARY.json) under `terms[]`. Filter by `category` (feature, knowledgeEntity, technicalVocab, actionVerb, deploymentVocab, role, brand, acronym, loanword, gitDomain, translateBucket, abbreviation) and check the `de` field.

Rules that govern those entries:

- **Match the shipped UI verbatim.** Before quoting a button or menu, grep `services/platform/messages/de.json`. When the UI and the glossary disagree, update the UI first, then the glossary, in the same PR.
- **Capitalise when naming the role**; lowercase when the word is generic and matches the everyday German noun (`die Mitglieder deines Teams`).
- **The lint enforces role mappings for Owner, Developer, Member/Members, and Disabled.** `role_editor` carries `_lintExclude: ["de"]` because the same English word also appears as a UI loanword for visual workflow editors and IDE editors (`Workflow-Editor`, `KI-Editor`); translate role-context occurrences to `Redakteur` by hand.
- **Bucket 3 terms must translate.** `Header → Kopfzeile`, `Request → Anfrage`, `Provider → Anbieter`, `Email → E-Mail`, `Help Center → Hilfe-Center`, `Billing → Abrechnung`, `Sales Research → Vertriebs-Recherche`, `Draft → Entwurf`, `Attachment → Anhang`, `Self-hosted → selbst gehostet`. The full list lives in [`GLOSSARY.json`](GLOSSARY.json) under `category === "translateBucket"`.

---

## 4 · Toasts and error messages

Toast confirmations follow one pattern. Past participle, no period, the noun comes first. **`Erfolgreich` is never included.**

| Pattern                    | Example                   |
| -------------------------- | ------------------------- |
| `<Noun> <past-participle>` | `Agent gespeichert`       |
| `<Noun> <past-participle>` | `Anbieter gelöscht`       |
| `<Noun> <past-participle>` | `Workflow veröffentlicht` |

Error messages name what happened and what to do next, one sentence ending with a period, never blaming the reader. The cross-locale pattern table lives in [`TERMINOLOGY.md`](TERMINOLOGY.md) §5.

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
- **`ss` vs `ß` — strict per locale.** Base German (`de/`) uses `ß` after long vowels and diphthongs (`Straße`, `groß`, `Schließen`, `gemäß`, `Standardmäßig`, `heißen`, `weiß`). Swiss German (`de-CH/`) uses `ss` exclusively. **Mixing the two in the same locale is a bug.**

### Date and number formatting

| Surface             | Format                                |
| ------------------- | ------------------------------------- |
| Date in prose       | `19.04.2026`                          |
| ISO date in code    | `2026-04-19`                          |
| Decimal in prose    | `2,5 GB`                              |
| Decimal in code     | `2.5`                                 |
| Thousands separator | `1.000` or `1 000` (narrow space)     |
| Time, wall clock    | `09:00`, `22:30` (24-hour)            |
| Time, server-side   | UTC, 24-hour                          |
| Units               | `MB`, `GB`, `s`, `ms`                 |
| Currency            | `100 €`, `CHF 100`                    |
| Percent             | `5 %` (non-breaking space)            |
| Quote marks         | `„text"` in prose; `"..."` in UI/code |
| Apostrophe          | `'` (ASCII everywhere)                |
