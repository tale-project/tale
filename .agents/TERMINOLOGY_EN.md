# English (en) terminology

English is the source locale. All other locale files derive from `en.json`. See `TERMINOLOGY.md` for cross-locale rules.

## Preferred forms

| Term                       | Preferred form    | Notes                                                    |
| -------------------------- | ----------------- | -------------------------------------------------------- |
| AI                         | AI                | Not "A.I." or "Artificial Intelligence"                  |
| Agent                      | Agent             | Capitalized when referring to a Tale agent               |
| Workflow                   | Workflow          | One word, not "work flow"                                |
| Dashboard                  | Dashboard         | One word                                                 |
| Webhook                    | Webhook           | One word                                                 |
| Knowledge base             | Knowledge base    | Two words, lowercase except at the start of a sentence   |
| Workspace                  | Workspace         | One word                                                 |
| API / LLM / Token / Prompt | Keep as-is        | Universal tech terms, no expansion                       |
| Provider                   | Provider          | For LLM/email providers                                  |
| Settings                   | Settings          | Not "Preferences" or "Options"                           |
| Knowledge                  | Knowledge         | For the knowledge base feature                           |
| Automation(s)              | Automation(s)     | Not "Workflow" (distinct features)                       |
| Integration(s)             | Integration(s)    |                                                          |
| Log in / Log out           | Log in / Log out  | Two words as verb, "Login" as noun/adj                   |
| Sign up                    | Sign up           | Two words as verb, "Signup" as noun/adj                  |
| E-mail                     | E-mail            | With hyphen                                              |
| Upload / Download          | Upload / Download |                                                          |
| PII                        | PII               | Personally identifiable information                      |
| Self-hosted                | Self-hosted       | Hyphenated adjective ("a self-hosted platform")          |
| On-premises                | On-premises       | With final `s`; not "on-premise"                         |
| Open source                | Open source       | Two words as adjective ("open source platform") and noun |
| Zero-downtime              | Zero-downtime     | Hyphenated adjective                                     |
| OpenAI-compatible          | OpenAI-compatible | Hyphenated                                               |
| Blue-green (deployment)    | Blue-green        | Hyphenated                                               |

## Role names

Tale's six roles are proper nouns: **Owner**, **Admin**, **Developer**, **Editor**, **Member**, **Disabled**. Capitalize them when referring to the role (a Member can view chat history). Use lowercase when referring to a person generically (members of your team use the app to…). Never abbreviate (no "Admin." or "Mem.").

## Style rules (English-specific)

- USE the Oxford comma in lists.
- USE curly quotes (`"..."`) in running prose, straight quotes (`"..."`) inside UI strings and code blocks.
- USE en-dashes (`–`) for numeric ranges (`5–10 minutes`), em-dashes (`—`) for asides — like this.
- USE ISO dates (`2026-04-19`) in docs prose, log output, and frontmatter. UI wall-clock times use the user's locale format from `useFormatDate()`.
- USE 12-hour clock with lowercase am/pm in user-facing copy (`9 am`, `10:30 pm`). Use 24-hour in technical contexts (cron, server logs).
- PREFER "set up" (verb) and "setup" (noun). "Log in" (verb), "login" (noun/adj). Same pattern for "sign up/signup" and "back up/backup".
