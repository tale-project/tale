# German (de) terminology

German base locale for the platform UI (`services/platform/messages/de.json`), the marketing site (`services/web/messages/de.json`), and the docs site (`docs/de/` page bodies plus `services/docs/messages/de.json` chrome strings). Cross-locale rules — voice, the loanword policy, length, plurals, placeholders — live in [`TERMINOLOGY.md`](TERMINOLOGY.md); read that file first. English source forms live in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md).

Regional variants extend this file with deltas only:

- [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md) — Swiss German

---

## 1 · The German voice — what it is, what it isn't

German translation that preserves vocabulary but loses voice is still wrong. Tale's German narrator is the same calm, opinionated, second-person-informal voice as the English one — not a translator's careful neutral.

### Five rules the voice always respects

**1. `du`, never `Sie`.** The informal form is used consistently across UI, marketing, and docs. Inflections (`dein`, `deine`, `dir`) follow. Enforced by [`terminology.test.ts`](../../services/docs/tests/terminology.test.ts).

**2. Active verbs in present tense.** `Speichert die Änderungen` not `Die Änderungen werden gespeichert`. UI feedback messages have an obvious agent (the system) and benefit from the active form.

**3. Imperative for instructions.** `Führe tale deploy aus` — not `Du kannst tale deploy ausführen`, not `Bitte führe tale deploy aus`. The reader didn't ask for permission.

**4. Why before what.** Same as English. `Führe tale deploy aus — das stösst einen Blue-Green-Rollout an, der den alten Container weiterserve, bis der neue seine Health-Checks besteht.`

**5. Same words across the corpus.** Pick one and stay with it:

- `Website` (not `Webseite` — `Webseite` means a single page; we mean the whole site).
- `Nutzer` (not `Benutzer` — both work, but Tale ships `Nutzer`-derived strings).
- `Konversation` (not `Unterhaltung` — matches `navigation.conversations`).
- `E-Mail` (not `Email`, not `E-mail`).
- `Anmelden` / `Abmelden` (not `Einloggen` / `Ausloggen` — too colloquial for product copy).

### The Twelve Marketing Softeners — strike on sight (DE)

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
| `{count} Elemente erfolgreich gelöscht` | `{count} Elemente gelöscht` | Same — ICU still passes through.                             |

Strike `erfolgreich` from every confirmation toast. Keep it only when the page contrasts success and failure cases explicitly (`erfolgreich abgeschlossen vs. fehlgeschlagen`).

### Anti-pattern 3 · `Damit` as a sentence opener

| Drift                                                   | Target                                               |
| ------------------------------------------------------- | ---------------------------------------------------- |
| `Damit werden Agents, Workflows und Anbieter entfernt.` | `Entfernt Agents, Workflows und Anbieter.`           |
| `Damit kannst du die Konversation fortsetzen.`          | `So setzt du die Konversation fort.` or `Setzt du …` |

`Damit` is correct German but it's a translator's tic. The simpler verb-first construction reads native.

### Anti-pattern 4 · Compound stacking

German loves compound nouns — but four-root compounds are a smell.

| Drift                                           | Target                                                    |
| ----------------------------------------------- | --------------------------------------------------------- |
| `Organisationsmitgliederzugriffsverwaltung`     | `Zugriff auf die Mitglieder der Organisation verwalten`   |
| `Workflow-Schritt-Status-Aktualisierungs-Event` | `Statusänderung eines Workflow-Schritts` (or restructure) |
| `Kundendokumentablageverzeichnis`               | `Ablageverzeichnis für Kundendokumente`                   |

Two-root compounds are German's strength (`Wissensdatenbank`, `Arbeitsbereich`). Three-root compounds are still fine when one root is an English loanword or abbreviation (`MCP-Server-Adresse`, `API-Schlüssel-Rotation`). Four-root stacks should be split.

### Anti-pattern 5 · Calqued English idioms

| EN source                       | Calque (wrong)                              | Native (right)                                            |
| ------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `Published certification story` | `Veröffentlichte Zertifizierungsgeschichte` | `Veröffentlichte Zertifizierungen` or name them           |
| `Trust posture`                 | `Vertrauenshaltung`                         | `Unsere Zertifizierungen` (concrete) or `Sicherheitslage` |
| `Operational surface`           | `Operative Seite`                           | `Der Betrieb`                                             |
| `User journey`                  | `Nutzerreise`                               | `Ablauf` or `Nutzerablauf`                                |
| `Data story`                    | `Datengeschichte`                           | `Daten` or `Datenverlauf`                                 |
| `Sales motion`                  | `Verkaufsbewegung`                          | `Vertriebsprozess` or restructure                         |
| `In the loop`                   | `In der Schleife`                           | `Eingebunden`                                             |
| `Out of the box`                | `Aus der Box`                               | `Sofort einsatzbereit` or describe what's pre-configured  |

When the English uses an abstract noun (`story`, `journey`, `posture`, `surface`), translate the **meaning**, not the noun.

### Anti-pattern 6 · The English word in the middle of a German sentence

Caught by [`loanword.test.ts`](../../services/docs/tests/loanword.test.ts). See Bucket 3 in [`TERMINOLOGY.md`](TERMINOLOGY.md).

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

### Anti-pattern 7 · Sie-Slips

Most common at sentence starts after a colon (`X: Sie halten…`), where `Sie` _can_ be the third-person plural pronoun (`they`) referring to a previous noun. Avoid the construction even when grammatically third-person, because the lint flags it.

| Drift                                      | Target                                                   |
| ------------------------------------------ | -------------------------------------------------------- |
| `Vier Entscheidungen: Sie halten überall.` | `Vier Entscheidungen — dieselben Knöpfe halten überall.` |
| `Bitte beachten Sie:`                      | `Beachte:` (or drop entirely)                            |
| `Wenden Sie sich an den Support.`          | `Wende dich an den Support.`                             |

### Anti-pattern 8 · Lazy capitalisation

| Drift             | Target                                                         |
| ----------------- | -------------------------------------------------------------- |
| `email`           | `E-Mail`                                                       |
| `pdf`             | `PDF`                                                          |
| `api`             | `API`                                                          |
| `self-Hosted`     | `selbst gehostet` (in prose) or `Self-Hosted` (as proper noun) |
| `selbst Gehostet` | `selbst gehostet`                                              |

---

## 3 · Product features

Match the UI verbatim — if the two ever disagree, update the UI first, then this file.

| English              | German                             | Notes                                                                                                               |
| -------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Agent                | Agent                              | Established loanword.                                                                                               |
| Chat / Chat with AI  | Chat mit KI                        | Matches UI label `navigation.chatWithAI`. The plain noun `Chat` is fine when context is clear.                      |
| Conversations        | Konversationen                     | Multi-channel inbox feature. Matches UI label `navigation.conversations`. Singular `Konversation` mirrors `Thread`. |
| Workflow             | Workflow                           | Loanword.                                                                                                           |
| Automation(s)        | Automatisierung(en)                | Matches UI label `navigation.automations`.                                                                          |
| Integration(s)       | Integration(en)                    | Same root in German. Matches UI label `navigation.integrations`.                                                    |
| Dashboard            | Dashboard                          | Loanword.                                                                                                           |
| Knowledge            | Wissen                             |                                                                                                                     |
| Knowledge base       | Wissensdatenbank                   | Single compound noun.                                                                                               |
| Workspace            | Arbeitsbereich                     |                                                                                                                     |
| Canvas               | Canvas                             | Loanword. Matches UI label `chat.canvas.title`.                                                                     |
| Composer             | Composer                           | Loanword. Matches UI label `composer.openMenu` (`Composer-Menü`).                                                   |
| Prompt library       | Prompt-Bibliothek                  | Matches UI label `chat.promptLibrary` — never `Prompt Library`.                                                     |
| Arena Mode           | Arena-Modus                        | Hyphenated compound. Matches UI label `chat.arena.title`.                                                           |
| Research plan        | Recherche-Plan                     | Matches UI label `todoList.title` — **never** `Todo-Liste` in user-facing prose.                                    |
| Approval / Approvals | Genehmigung / Genehmigungen        | Singular for one pending item; plural for the workspace view. **Never** `Freigabe`/`Freigaben`.                     |
| Human input request  | Benutzeranfrage                    | Fall back to `Frage an Nutzer` if the UI string is still unclear.                                                   |
| Location request     | Standortanfrage                    | Matches UI label `locationRequest.title`.                                                                           |
| Audit log            | Audit-Log                          | Hyphenated compound.                                                                                                |
| Legal hold           | Aufbewahrungs-Pflicht / Legal Hold | Legal-technical compound. Both forms used; pick one per page and stay with it.                                      |

---

## 4 · Knowledge-base entities

| English              | German                  | Notes                                                                                     |
| -------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Website / Websites   | Website / Websites      | Loanword. Matches UI label `websites.title`.                                              |
| Customer / Customers | Kunde / Kunden          | Matches UI label `customers.title`.                                                       |
| Vendor / Vendors     | Lieferant / Lieferanten | Matches UI label `vendors.title`.                                                         |
| Product / Products   | Produkt / Produkte      | Matches UI label `products.title`.                                                        |
| Document / Documents | Dokument / Dokumente    | Matches UI label `documents.title`.                                                       |
| Thread               | **Konversation**        | Use `Konversation` in user-facing prose. `Thread` stays only in code and API identifiers. |
| Folder               | Ordner                  |                                                                                           |

---

## 5 · Technical vocabulary

| English        | German              | Notes                                                                      |
| -------------- | ------------------- | -------------------------------------------------------------------------- |
| AI             | KI                  | Künstliche Intelligenz.                                                    |
| API            | API                 | Loanword.                                                                  |
| LLM            | LLM                 | Loanword.                                                                  |
| Token          | Token               | Loanword.                                                                  |
| Prompt         | Prompt              | Loanword.                                                                  |
| Webhook        | Webhook             | Loanword.                                                                  |
| Provider       | Anbieter            | **Translate** — never leave as `Provider` in DE prose.                     |
| Settings       | Einstellungen       |                                                                            |
| PII            | PII                 | Expand on first use as `personenbezogene Daten (PII)`.                     |
| MCP server     | MCP-Server          | Hyphenated compound. Matches UI label `mcpServers.title`.                  |
| API key        | API-Schlüssel       | Hyphenated compound.                                                       |
| Browser        | Browser             | Loanword.                                                                  |
| Status         | Status              | Loanword.                                                                  |
| Tool           | Tool                | Loanword in product context. Use `Werkzeug` only in metaphors.             |
| Pipeline       | Pipeline            | Loanword.                                                                  |
| Cache          | Cache               | Loanword.                                                                  |
| Snapshot       | Snapshot            | Loanword.                                                                  |
| Endpoint       | Endpoint            | Loanword.                                                                  |
| Payload        | Payload             | Loanword.                                                                  |
| Rate limit     | Rate-Limit          | Hyphenated loanword. `Anfragelimit` is acceptable in long-form prose.      |
| Email          | E-Mail              | **Translate** — never leave as `Email`. Hyphenated form is standard.       |
| Header         | Kopfzeile           | **Translate** — never leave as `Header` outside HTTP-header code contexts. |
| Request        | Anfrage             | **Translate**. Use `HTTP-Anfrage` for clarity if needed.                   |
| Help Center    | Hilfe-Center        | **Translate**.                                                             |
| Billing        | Abrechnung          | **Translate**.                                                             |
| Sales Research | Vertriebs-Recherche | **Translate**.                                                             |
| Draft          | Entwurf             | **Translate**.                                                             |
| Attachment     | Anhang              | **Translate**.                                                             |
| Backup         | Backup              | Loanword (noun). The verb `back up` translates as `sichern`.               |
| Health check   | Health-Check        | Hyphenated loanword.                                                       |
| Reverse proxy  | Reverse-Proxy       | Hyphenated loanword.                                                       |

---

## 6 · Actions and state verbs

| English   | German                          | Notes                                         |
| --------- | ------------------------------- | --------------------------------------------- |
| Save      | Speichern                       |                                               |
| Delete    | Löschen                         |                                               |
| Edit      | Bearbeiten                      |                                               |
| Cancel    | Abbrechen                       |                                               |
| Confirm   | Bestätigen                      |                                               |
| Close     | Schliessen                      | (in DE-CH: same — already `ss`)               |
| Add       | Hinzufügen                      |                                               |
| Remove    | Entfernen                       |                                               |
| Create    | Erstellen                       |                                               |
| Duplicate | Duplizieren                     |                                               |
| Send      | Senden                          |                                               |
| Receive   | Empfangen                       |                                               |
| Approve   | Genehmigen                      |                                               |
| Reject    | Ablehnen                        |                                               |
| Publish   | Veröffentlichen                 |                                               |
| Archive   | Archivieren                     |                                               |
| Restore   | Wiederherstellen                |                                               |
| Enable    | Aktivieren                      |                                               |
| Disable   | Deaktivieren                    |                                               |
| Log in    | Anmelden                        | Not `Einloggen` — too colloquial.             |
| Log out   | Abmelden                        | Not `Ausloggen`.                              |
| Sign up   | Registrieren                    |                                               |
| Upload    | Hochladen                       | Verb; the noun `Upload` is also acceptable.   |
| Download  | Herunterladen                   | Verb; the noun `Download` is also acceptable. |
| Back up   | Sichern (verb), Backup (noun)   | Translate the verb; the noun stays English.   |
| Set up    | Einrichten (verb), Setup (noun) | Translate the verb; the noun stays English.   |

### Toast-message conventions (DE)

State-change confirmations follow a pattern. Past participle, no period, the noun comes first. `Erfolgreich` is never included.

| Pattern                    | Example                   |
| -------------------------- | ------------------------- |
| `<Noun> <past-participle>` | `Agent gespeichert`       |
| `<Noun> <past-participle>` | `Anbieter gelöscht`       |
| `<Noun> <past-participle>` | `Workflow veröffentlicht` |

---

## 7 · Deployment vocabulary

| English        | German                                   | Notes                                                                               |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| Self-hosted    | selbst gehostet                          | **Translate** — two words, lowercase unless starting a sentence.                    |
| On-premises    | on-premises                              | Loanword. Alternative: `im eigenen Rechenzentrum`.                                  |
| Open source    | Open Source                              | Loanword; capitalise both words as a noun (German noun-capitalisation rules apply). |
| Zero-downtime  | Zero-Downtime                            | Loanword, hyphenated.                                                               |
| Blue-green     | Blue-Green                               | Loanword, hyphenated.                                                               |
| Docker Compose | Docker Compose                           | Brand. Keep English.                                                                |
| Team           | Team                                     | Loanword — matches the UI.                                                          |
| Branding       | Branding                                 | Loanword.                                                                           |
| Air-gapped     | Air-Gap (noun), abgeschottet (adjective) | Loanword as noun; native form as adjective acceptable.                              |
| Data residency | Datenresidenz                            |                                                                                     |

---

## 8 · Role names

Translate role names to match the shipped DE UI labels (`services/platform/messages/de.json`):

| English   | DE form         |
| --------- | --------------- |
| Owner     | **Inhaber**     |
| Admin     | **Admin**       |
| Developer | **Entwickler**  |
| Editor    | **Redakteur**   |
| Member    | **Mitglied**    |
| Disabled  | **Deaktiviert** |

Capitalise when naming the role (`ein Inhaber kann das Eigentum übertragen`); use lowercase when the word is purely generic and matches the everyday German noun (`die Mitglieder deines Teams`).

The lint enforces these mappings for Owner, Developer, Member/Members, and Disabled. **Editor is not enforced by lint** because the same English word also appears as a UI loanword for the visual workflow editor and IDE editors (`Workflow-Editor`, `KI-Editor`, `Source-Editor`); translate the role-context occurrences to **Redakteur** by hand.

---

## 9 · Style rules

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
- **`ss` vs `ß`:** standard German uses `ß` after long vowels and diphthongs (`Strasse` → `Straße`, `gross` → `groß`). Swiss German always uses `ss` — see [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md). The base files use `ß`.

---

## Quick reference

| Question                                          | Answer                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `du` or `Sie`?                                    | `du`. Always. Inflections too.                                                            |
| `Wird gespeichert…` or `Speichert…`?              | `Speichert…`.                                                                             |
| `… erfolgreich aktualisiert` or `… aktualisiert`? | `… aktualisiert`.                                                                         |
| `Header` or `Kopfzeile` in prose?                 | `Kopfzeile`. `Header` is fine inside HTTP-header code contexts.                           |
| `Email` or `E-Mail`?                              | `E-Mail`. Always.                                                                         |
| `Provider` or `Anbieter`?                         | `Anbieter`.                                                                               |
| `Workflow` or `Arbeitsablauf`?                    | `Workflow`. Established loanword.                                                         |
| `Self-hosted` or `selbst gehostet`?               | `selbst gehostet` in prose. `Self-Hosted` only as a proper noun referring to the edition. |
| `Einloggen` or `Anmelden`?                        | `Anmelden`.                                                                               |
| `Webseite` or `Website`?                          | `Website`.                                                                                |
| `Nutzer` or `Benutzer`?                           | `Nutzer`.                                                                                 |
| `Konversation` or `Unterhaltung`?                 | `Konversation`.                                                                           |
