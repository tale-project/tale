# German (de) terminology

See [`TERMINOLOGY.md`](TERMINOLOGY.md) for cross-locale rules. Regional variants have their own files with the delta from this base:

- Austria: [`TERMINOLOGY_DE_AT.md`](TERMINOLOGY_DE_AT.md)
- Switzerland: [`TERMINOLOGY_DE_CH.md`](TERMINOLOGY_DE_CH.md)

## Preferred forms

| English                        | German                           | Notes                                                |
| ------------------------------ | -------------------------------- | ---------------------------------------------------- |
| AI                             | KI                               | Künstliche Intelligenz                               |
| Agent                          | Agent                            | Established tech term                                |
| Workflow / Dashboard / Webhook | Keep English                     | Established loanwords                                |
| API / LLM / Token / Prompt     | Keep English                     | Universal tech terms                                 |
| Provider                       | Anbieter                         |                                                      |
| Settings                       | Einstellungen                    |                                                      |
| Knowledge                      | Wissen                           |                                                      |
| Knowledge base                 | Wissensdatenbank                 | Single compound noun                                 |
| Workspace                      | Arbeitsbereich                   |                                                      |
| Automation(s)                  | Automatisierung(en)              |                                                      |
| Team / Branding                | Keep English                     | Loanwords                                            |
| Integration(s)                 | Integration(en)                  | Same in German                                       |
| Save / Delete / Edit           | Speichern / Löschen / Bearbeiten |                                                      |
| Log in                         | Anmelden                         |                                                      |
| Log out                        | Abmelden                         |                                                      |
| Sign up                        | Registrieren                     |                                                      |
| Upload                         | Hochladen                        | Verb; "Upload" (noun) also acceptable                |
| Download                       | Herunterladen                    | Verb; "Download" (noun) also acceptable              |
| E-mail                         | E-Mail                           | With hyphen, capital M                               |
| Self-hosted                    | selbst gehostet                  | Two words, lowercase unless starting a sentence      |
| On-premises                    | on-premises                      | Loanword; alternative: "im eigenen Rechenzentrum"    |
| Open source                    | Open Source                      | Loanword; capitalise both words as noun              |
| Browser                        | Browser                          | Loanword                                             |
| Canvas                         | Canvas                           | Keep English (product feature name)                  |
| Prompt / Prompt Library        | Prompt / Prompt Library          | Keep English (product feature names)                 |
| Provider file                  | Provider-Datei                   | Hyphenated compound                                  |
| API key                        | API-Schlüssel                    | Hyphenated compound                                  |
| Docker Compose                 | Docker Compose                   | Brand; keep English                                  |
| Zero-downtime                  | Zero-Downtime                    | Keep English, hyphenated                             |
| Blue-green                     | Blue-Green                       | Keep English, hyphenated                             |

## Role names

Tale's roles stay in English as loanwords (matches the UI): **Owner**, **Admin**, **Developer**, **Editor**, **Member**, **Disabled**. In role references, capitalise them.

When "member" is used generically (not as the Member role), translate to **Mitglied(er)**. Example: "Die Mitglieder deines Teams nutzen den Chat" vs. "Ein Member kann den Chat-Verlauf einsehen".

## Style rules (German-specific)

- USE the informal "du" form consistently — never "Sie" for addressing the user.
- USE standard German compounding for compound nouns. Hyphenate when a component is an English loanword, an abbreviation, or when it improves readability: "API-Schlüssel", "E-Mail-Anbieter", "Docker-Service", "JSON-Datei".
- USE double low-9 opening + double high-9 closing quotation marks in running prose: „Text". Straight `"..."` inside UI labels and code blocks.
- USE comma as decimal separator in docs prose (`2,5 GB`). Inside code blocks and env-var values, keep the period (`2.5`) — the runtime expects it.
- USE period or narrow space as thousands separator (`1.000` or `1 000`). Be consistent within a single doc.
- DATES in docs prose: `DD.MM.YYYY` (e.g. `19.04.2026`). In frontmatter and technical context, use ISO (`2026-04-19`).
- USE 24-hour clock (`09:00`, `17:30`).
- AVOID English gerunds translated as "-ing" forms. Prefer German verb forms or nouns: "Logging" → "Protokollierung" where it reads naturally.
- KEEP HEADINGS in sentence case: `## Agent-Konzepte`, not `## Agent-Konzepte In Tale`.
- DO NOT translate UI labels that remain English in the product. A doc that says "klicke auf Delete" should match whatever the UI actually shows — confirm against `messages/de.json`.
