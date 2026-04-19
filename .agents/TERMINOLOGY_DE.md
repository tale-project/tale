# German (de) terminology

German base locale for the platform UI (`services/platform/messages/de.json`) and the Mintlify docs (`docs/de/`). Cross-locale rules — length, tone, plurals, placeholders — live in [`TERMINOLOGY.md`](TERMINOLOGY.md); read that file first. English source forms live in [`TERMINOLOGY_EN.md`](TERMINOLOGY_EN.md).

Regional variants extend this file with deltas only:

- [`TERMINOLOGY_DE_AT.md`](TERMINOLOGY_DE_AT.md) — Austrian German
- [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md) — Swiss German

## Product features

These are the feature names users see in the UI and read in the docs. Match the UI verbatim — if the two ever disagree, update the UI first, then this file.

| English | German | Notes |
| --- | --- | --- |
| Agent | Agent | Established loanword. |
| Workflow | Workflow | Loanword. |
| Automation(s) | Automatisierung(en) | |
| Integration(s) | Integration(en) | Same root in German. |
| Dashboard | Dashboard | Loanword. |
| Knowledge | Wissen | |
| Knowledge base | Wissensdatenbank | Single compound noun. |
| Workspace | Arbeitsbereich | |
| Canvas | Canvas | Keep English. Matches UI label `chat.canvas.title`. |
| Composer | Composer | Keep English. Matches UI label `composer.openMenu` (`Composer-Menü`). |
| Prompt library | Prompt-Bibliothek | Matches UI label `chat.promptLibrary` — never the loanword `Prompt Library`. |
| Arena Mode | Arena-Modus | Hyphenated compound. Matches UI label `chat.arena.title`. |
| Research plan | Recherche-Plan | Matches UI label `todoList.title` — **never** `Todo-Liste` in user-facing prose. |
| Approval / Approvals | Genehmigung / Genehmigungen | Singular for one pending item; plural for the workspace view. |
| Human input request | Benutzeranfrage | Context: a workflow step paused on a typed answer. Fall back to `Frage an Nutzer` if the UI string is still unclear. |
| Location request | Standortanfrage | Matches UI label `locationRequest.title`. |

## Knowledge-base entities

| English | German | Notes |
| --- | --- | --- |
| Website / Websites | Website / Websites | Loanword. Matches UI label `websites.title`. |
| Customer / Customers | Kunde / Kunden | Matches UI label `customers.title`. |
| Vendor / Vendors | Lieferant / Lieferanten | Matches UI label `vendors.title`. |
| Product / Products | Produkt / Produkte | Matches UI label `products.title`. |
| Document / Documents | Dokument / Dokumente | Matches UI label `documents.title`. |
| Thread | **Konversation** | Use `Konversation` in user-facing prose. `Thread` stays only in code and API identifiers. |

## Technical vocabulary

| English | German | Notes |
| --- | --- | --- |
| AI | KI | Künstliche Intelligenz. |
| API / LLM / Token / Prompt | Keep English | Universal tech terms. |
| Webhook | Webhook | Loanword. |
| Provider | Anbieter | |
| Settings | Einstellungen | |
| PII | PII | Expand on first use as `personenbezogene Daten (PII)`. |
| MCP server | MCP-Server | Hyphenated compound. Matches UI label `mcpServers.title`. |
| API key | API-Schlüssel | Hyphenated compound. |
| Provider file | Provider-Datei | Hyphenated compound. |
| Browser | Browser | Loanword. |
| E-mail | E-Mail | Hyphen, capital `M`. |

## Actions and state verbs

| English | German | Notes |
| --- | --- | --- |
| Save | Speichern | |
| Delete | Löschen | |
| Edit | Bearbeiten | |
| Log in | Anmelden | |
| Log out | Abmelden | |
| Sign up | Registrieren | |
| Upload | Hochladen | Verb; the noun `Upload` is also acceptable. |
| Download | Herunterladen | Verb; the noun `Download` is also acceptable. |

## Deployment vocabulary

| English | German | Notes |
| --- | --- | --- |
| Self-hosted | selbst gehostet | Two words, lowercase unless starting a sentence. |
| On-premises | on-premises | Loanword. Alternative: `im eigenen Rechenzentrum`. |
| Open source | Open Source | Loanword; capitalize both words as a noun. |
| Zero-downtime | Zero-Downtime | Keep English, hyphenated. |
| Blue-green | Blue-Green | Keep English, hyphenated. |
| Docker Compose | Docker Compose | Brand. Keep English. |
| Team | Keep English | Loanword — matches the UI. |
| Branding | Keep English | Loanword. |

## Role names

The six Tale roles stay in English to match the UI: **Owner**, **Admin**, **Developer**, **Editor**, **Member**, **Disabled**. Capitalize when naming the role.

When the word is generic — someone on the team, not the capital-M Member role — translate it to **Mitglied** / **Mitglieder**. Example: *Die Mitglieder deines Teams nutzen den Chat* vs. *Ein Member kann den Chat-Verlauf einsehen*.

## Style rules

- **`du`, never `Sie`.** The informal form is used consistently across UI and docs.
- **Compound nouns follow standard German rules.** Hyphenate when a component is an English loanword, an abbreviation, or when the hyphen improves readability: `API-Schlüssel`, `E-Mail-Anbieter`, `Docker-Service`, `JSON-Datei`.
- **Quotation marks:** `„Text"` (low-9 opening, high-9 closing) in running prose. Straight `"..."` inside UI labels and code blocks.
- **Decimal comma** in docs prose (`2,5 GB`). Inside code blocks and env var values, keep the period (`2.5`) — the runtime expects it.
- **Thousands separator:** period or narrow space (`1.000` or `1 000`). Stay consistent within a page.
- **Dates:** `DD.MM.YYYY` in docs prose (`19.04.2026`). In frontmatter and technical contexts, use ISO (`2026-04-19`).
- **Times:** 24-hour clock (`09:00`, `17:30`).
- **Gerunds:** avoid English `-ing` forms dropped untranslated. Prefer German verb forms or native nouns — `Logging` → `Protokollierung` where the sense allows.
- **Headings are sentence case.** `## Agent-Konzepte`, not `## Agent-Konzepte In Tale`.
- **UI labels must match the product.** Before quoting a button or menu, grep `services/platform/messages/de.json` to confirm the exact wording.
