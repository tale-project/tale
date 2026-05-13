# English (en) terminology

English is the source locale. Every translated string in the platform UI and in `docs/` derives from an English original; when the two drift, the English form is the authoritative reference. Cross-locale rules (length parity, tone, placeholders) live in [`TERMINOLOGY.md`](TERMINOLOGY.md) — read that file first.

This file exists to freeze the English spellings of Tale's product vocabulary, so that the same concept does not appear under three different names across the codebase.

## Product features

Proper nouns. Capitalize when naming the feature; use lowercase in running prose where the feature name becomes a common noun (`in the canvas`, `open the knowledge base`).

| Term                 | Preferred form       | Notes                                                                                                                                              |
| -------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent                | Agent                | Capitalized when referring to a Tale agent; lowercase as a general AI term.                                                                        |
| Chat / Chat with AI  | Chat with AI         | The conversational AI feature. Matches UI label `navigation.chatWithAI`. Use plain `Chat` only when the surrounding sentence makes it unambiguous. |
| Conversations        | Conversations        | The multi-channel inbox feature. Matches UI label `navigation.conversations`. Distinct from `Thread` (the data-model term).                        |
| Workflow             | Workflow             | One word.                                                                                                                                          |
| Automation(s)        | Automation(s)        | Distinct from Workflow — do not use the two interchangeably. Matches UI label `navigation.automations`.                                            |
| Integration(s)       | Integration(s)       | Matches UI label `navigation.integrations`.                                                                                                        |
| Dashboard            | Dashboard            | One word.                                                                                                                                          |
| Knowledge base       | Knowledge base       | Two words, lowercase except at the start of a sentence.                                                                                            |
| Knowledge            | Knowledge            | The top-level feature area the knowledge base sits inside.                                                                                         |
| Workspace            | Workspace            | One word.                                                                                                                                          |
| Canvas               | Canvas               | Capitalized when naming the feature; lowercase in prose (`in the canvas`). Matches UI label `chat.canvas.title`.                                   |
| Composer             | Composer             | The chat input area. Capitalize when naming the UI element.                                                                                        |
| Prompt library       | Prompt library       | Two words, sentence case in prose. Matches UI label `chat.promptLibrary`.                                                                          |
| Arena Mode           | Arena Mode           | Title case, matches UI label `chat.arena.title`.                                                                                                   |
| Research plan        | Research plan        | The agent to-do pane. The i18n key is `todoList.title`, but the **product name is "Research plan"** — never use "Todo list" in user-facing prose.  |
| Approval / Approvals | Approval / Approvals | Singular for one pending action; plural for the workspace view. Matches UI label `contextApprovals`.                                               |
| Human input request  | Human input request  | A workflow step that pauses for a typed answer. Matches the UI label for the approval type.                                                        |
| Location request     | Location request     | A workflow step that asks for a location. Matches UI label `locationRequest.title`.                                                                |

## Knowledge-base entities

These are concrete entity types the user manages in the knowledge base. They are features _and_ nouns, so they appear throughout the UI, API, and docs.

| Term                 | Preferred form       | Notes                                                                                                                                          |
| -------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Website / Websites   | Website / Websites   | Matches UI label `websites.title`.                                                                                                             |
| Customer / Customers | Customer / Customers | Matches UI label `customers.title`.                                                                                                            |
| Vendor / Vendors     | Vendor / Vendors     | Matches UI label `vendors.title`.                                                                                                              |
| Product / Products   | Product / Products   | Matches UI label `products.title`.                                                                                                             |
| Document / Documents | Document / Documents | A file uploaded to the knowledge base.                                                                                                         |
| Thread               | **Conversation**     | In user-facing prose, the product term is **Conversation**. `Thread` only lives in code (the `threads` table) and a few internal API surfaces. |

## Technical vocabulary

Universal tech terms. Most stay as-is across locales.

| Term       | Preferred form | Notes                                                                                  |
| ---------- | -------------- | -------------------------------------------------------------------------------------- |
| AI         | AI             | Not `A.I.` or `Artificial Intelligence`.                                               |
| API        | API            |                                                                                        |
| LLM        | LLM            |                                                                                        |
| Token      | Token          |                                                                                        |
| Prompt     | Prompt         |                                                                                        |
| Webhook    | Webhook        | One word.                                                                              |
| Provider   | Provider       | Used for LLM and email providers.                                                      |
| PII        | PII            | Expand as `personally identifiable information` on first use per long-form doc.        |
| MCP server | MCP server     | Model Context Protocol server. Lowercase `server`; expand `MCP` on first use per page. |
| Settings   | Settings       | Not `Preferences` or `Options`.                                                        |

## Actions and state verbs

These appear as button labels, menu items, and toast messages. Keep them short and imperative.

| Term                 | Preferred form       | Notes                                                                                                                  |
| -------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Log in / Log out     | Log in / Log out     | Two words as a verb. `Login` / `Logout` one word as a noun or adjective.                                               |
| Sign up              | Sign up              | Verb. `Signup` as noun or adjective.                                                                                   |
| Set up               | Set up               | Verb. `Setup` as noun.                                                                                                 |
| Back up              | Back up              | Verb. `Backup` as noun.                                                                                                |
| Upload / Download    | Upload / Download    | Verb and noun use the same form.                                                                                       |
| Save / Delete / Edit | Save / Delete / Edit |                                                                                                                        |
| Email                | Email                | One word, no hyphen. Capitalize as a label (`Email`), lowercase in prose (`email`). Reads more naturally than `Email`. |

## Deployment vocabulary

Terms that appear in install, operate, and configuration docs.

| Term              | Preferred form    | Notes                                                           |
| ----------------- | ----------------- | --------------------------------------------------------------- |
| Self-hosted       | Self-hosted       | Hyphenated adjective (`a self-hosted platform`).                |
| On-premises       | On-premises       | With final `s`. Never `on-premise`.                             |
| Open source       | Open source       | Two words, both as adjective (`open source platform`) and noun. |
| Zero-downtime     | Zero-downtime     | Hyphenated adjective.                                           |
| Blue-green        | Blue-green        | Hyphenated adjective.                                           |
| OpenAI-compatible | OpenAI-compatible | Hyphenated.                                                     |

## Role names

Tale's six roles are proper nouns: **Owner**, **Admin**, **Developer**, **Editor**, **Member**, **Disabled**. Capitalize when naming the role (`a Member can view chat history`). Use lowercase when the word is generic (`members of your team use the app to…`). Never abbreviate — `Admin.` and `Mem.` are not acceptable.

## Style rules

- **Oxford comma** in lists of three or more.
- **Straight quotes** (`"..."`) everywhere — running prose, UI strings, and code blocks. Tale's English docs do not use the typographic `“…”`; ASCII keeps grep simple and avoids drift between the two forms.
- **Apostrophes:** straight ASCII `'` everywhere — contractions (`don't`), possessives (`Tale's`), and quoted strings. The English docs do not use the typographic `’`; keep them ASCII so search and grep stay simple.
- **En-dash** (`–`) for numeric ranges (`5–10 minutes`); **em-dash** (`—`) for parenthetical asides — like this.
- **ISO dates** (`2026-04-19`) in docs prose, log output, and frontmatter. Wall-clock times in the UI render through `useFormatDate()` and use the user's locale format.
- **12-hour clock** with lowercase `am`/`pm` in user-facing copy (`9 am`, `10:30 pm`). **24-hour** in technical contexts (cron expressions, server logs).
- **Verb/noun pairings** keep the two-word/one-word pattern — `set up` (verb) / `setup` (noun); `log in` (verb) / `login` (noun); `sign up` / `signup`; `back up` / `backup`.
