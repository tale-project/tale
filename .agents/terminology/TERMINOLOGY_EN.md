# English (en) terminology

English is the source locale. Every translated string in the platform UI and in `docs/` derives from an English original; when the two drift, the English form is the authoritative reference. The cross-locale rules — voice, the loanword policy, length parity, plurals, placeholders, dates, numbers — live in [`TERMINOLOGY.md`](TERMINOLOGY.md). Read that file first.

This file freezes the English spellings of Tale's product vocabulary, so the same concept does not appear under three different names across the codebase, and documents the voice every translation has to land back in: calm, opinionated, second-person, **why before what**.

---

## 1 · The English voice

Tale's English copy reads as one narrator. The reader is a capable peer who landed cold from a search result.

- **Second person.** `You`, never `we`, never `the user`. Marketing addresses the prospective customer in the same voice as the signed-in product.
- **Informal but precise.** Contractions where they read naturally (`don't`, `won't`, `you'll`) — but never to the point of slang. Tale is not a meme; it's a product.
- **Imperative for instructions.** `Run tale deploy` — not `You can run tale deploy`, not `Please run tale deploy`, not `It is recommended to run tale deploy`.
- **No marketing softening.** Strike `simply`, `easy`, `powerful`, `seamless`, `just`, `please`, `feel free to`, `discover`, `unleash`, `effortlessly`, `straightforward`, `intuitive`. If a thing is easy, the surrounding evidence shows it.
- **No exclamation marks** outside literal code.
- **Why before what.** Every command, every config knob, every UI walkthrough names the consequence — what happens in production, what breaks, what the alternative would have meant.

### Twelve words to strike on sight

| Strike          | Replace with                                                |
| --------------- | ----------------------------------------------------------- |
| simply          | (delete; describe the step without softening)               |
| easy            | (delete; let the demonstration carry the claim)             |
| powerful        | (delete or replace with concrete capability)                |
| seamless        | (delete; describe the missing-step that makes it seamless)  |
| just            | (delete)                                                    |
| please          | (delete; imperative does the work)                          |
| feel free to    | (delete)                                                    |
| discover        | (replace with `see`, `read`, or `open`)                     |
| unleash         | (delete)                                                    |
| effortlessly    | (delete)                                                    |
| straightforward | (delete; the demonstration shows it)                        |
| intuitive       | (delete; let the screenshot or walkthrough carry the claim) |

### Anti-pattern catalogue (English)

- **First-person we.** `We recommend you click Save` → `Click Save`. Tale's docs describe a product the reader operates; the author is invisible.
- **The Royal "It is".** `It is important to note that…` → delete. `It is recommended to…` → `Do X`.
- **The Naked Command.** `Click Save.` (no why) → `Click Save. The provider is reachable from agents on the next request.`
- **The Hype Sentence.** `Tale's powerful automation engine lets you simply discover the seamless way to build workflows.` → `Tale's automation engine runs multi-step workflows on schedules, events, and webhooks.`
- **Status chatter.** `Note: this changed in v1.6.` → delete; release notes carry the version.
- **The Capitalisation Drift.** `Knowledge Base`, `Prompt Library`, `Todo List`. → `Knowledge base`, `Prompt library`, `Research plan` (sentence case + correct product name).

---

## 2 · Product features

Proper nouns. Capitalise when naming the feature; use lowercase in running prose where the feature name becomes a common noun (`in the canvas`, `open the knowledge base`).

| Term                 | Preferred form       | Notes                                                                                                                                                     |
| -------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent                | Agent                | Capitalised when referring to a Tale agent; lowercase as a general AI term.                                                                               |
| Chat / Chat with AI  | Chat with AI         | The conversational AI feature. Matches UI label `navigation.chatWithAI`. Use plain `Chat` only when the surrounding sentence makes it unambiguous.        |
| Conversations        | Conversations        | The multi-channel inbox feature. Matches UI label `navigation.conversations`. Distinct from `Thread` (the data-model term).                               |
| Workflow             | Workflow             | One word. The runnable unit of an automation.                                                                                                             |
| Automation(s)        | Automation(s)        | Distinct from Workflow — do not use the two interchangeably. Matches UI label `navigation.automations`.                                                   |
| Integration(s)       | Integration(s)       | Matches UI label `navigation.integrations`.                                                                                                               |
| Dashboard            | Dashboard            | One word.                                                                                                                                                 |
| Knowledge base       | Knowledge base       | Two words, lowercase except at the start of a sentence.                                                                                                   |
| Knowledge            | Knowledge            | The top-level feature area the knowledge base sits inside.                                                                                                |
| Workspace            | Workspace            | One word.                                                                                                                                                 |
| Canvas               | Canvas               | Capitalised when naming the feature; lowercase in prose (`in the canvas`). Matches UI label `chat.canvas.title`.                                          |
| Composer             | Composer             | The chat input area. Capitalise when naming the UI element.                                                                                               |
| Prompt library       | Prompt library       | Two words, sentence case in prose. Matches UI label `chat.promptLibrary`.                                                                                 |
| Arena Mode           | Arena Mode           | Title case, matches UI label `chat.arena.title`.                                                                                                          |
| Research plan        | Research plan        | The agent to-do pane. The i18n key is `todoList.title`, but the **product name is "Research plan"** — never use "Todo list" in user-facing prose.         |
| Approval / Approvals | Approval / Approvals | Singular for one pending action; plural for the workspace view. Matches UI label `contextApprovals`.                                                      |
| Human input request  | Human input request  | A workflow step that pauses for a typed answer.                                                                                                           |
| Location request     | Location request     | A workflow step that asks for a location. Matches UI label `locationRequest.title`.                                                                       |
| Audit log            | Audit log            | Two words. The platform's append-only event record.                                                                                                       |
| Legal hold           | Legal hold           | Two words. The retention-override mechanism documented at [`/self-hosted/configuration/retention`](../../docs/en/self-hosted/configuration/retention.md). |

---

## 3 · Knowledge-base entities

These are concrete entity types the user manages in the knowledge base. They are features _and_ nouns, so they appear throughout the UI, API, and docs.

| Term                 | Preferred form       | Notes                                                                                                                                          |
| -------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Website / Websites   | Website / Websites   | Matches UI label `websites.title`.                                                                                                             |
| Customer / Customers | Customer / Customers | Matches UI label `customers.title`.                                                                                                            |
| Vendor / Vendors     | Vendor / Vendors     | Matches UI label `vendors.title`.                                                                                                              |
| Product / Products   | Product / Products   | Matches UI label `products.title`.                                                                                                             |
| Document / Documents | Document / Documents | A file uploaded to the knowledge base.                                                                                                         |
| Thread               | **Conversation**     | In user-facing prose, the product term is **Conversation**. `Thread` only lives in code (the `threads` table) and a few internal API surfaces. |
| Folder               | Folder               | Lowercase in prose; capitalise as a UI label when it appears in the navigation.                                                                |

---

## 4 · Technical vocabulary

Universal tech terms. Most stay as-is across locales; the ones with native DE/FR equivalents are documented per locale.

| Term        | Preferred form | Notes                                                                                  |
| ----------- | -------------- | -------------------------------------------------------------------------------------- |
| AI          | AI             | Not `A.I.` or `Artificial Intelligence`.                                               |
| API         | API            |                                                                                        |
| LLM         | LLM            |                                                                                        |
| Token       | Token          |                                                                                        |
| Prompt      | Prompt         |                                                                                        |
| Webhook     | Webhook        | One word.                                                                              |
| Provider    | Provider       | Used for LLM and email providers. Translates in DE/FR — see locale files.              |
| Settings    | Settings       | Not `Preferences` or `Options`.                                                        |
| PII         | PII            | Expand as `personally identifiable information` on first use per long-form doc.        |
| MCP server  | MCP server     | Model Context Protocol server. Lowercase `server`; expand `MCP` on first use per page. |
| Header      | Header         | HTTP header or table header. Translates in DE/FR — see locale files.                   |
| Request     | Request        | HTTP request, API request. Translates in DE/FR — see locale files.                     |
| Response    | Response       | HTTP response. Does not translate (both DE and FR accept it as a loanword).            |
| Email       | Email          | One word, no hyphen. Translates in DE (`E-Mail`) and FR (`Courriel`).                  |
| Help Center | Help Center    | Two words, title-cased. Translates in DE/FR.                                           |
| Draft       | Draft          | Translates in DE (`Entwurf`) and FR (`Brouillon`).                                     |
| Attachment  | Attachment     | Translates in DE (`Anhang`) and FR (`Pièce jointe`).                                   |
| Pipeline    | Pipeline       | Loanword in DE and FR.                                                                 |
| Status      | Status         | Loanword in DE and FR.                                                                 |
| Background  | Background     | In tech sense (background job, background refresh).                                    |
| Foreground  | Foreground     |                                                                                        |
| Cache       | Cache          | Loanword in DE and FR.                                                                 |
| Snapshot    | Snapshot       | Loanword in DE and FR.                                                                 |
| Endpoint    | Endpoint       | Loanword in DE and FR.                                                                 |
| Payload     | Payload        | Loanword in DE and FR.                                                                 |
| Throttling  | Throttling     | Loanword in DE and FR.                                                                 |
| Rate limit  | Rate limit     | Two words. Loanword in DE and FR.                                                      |

---

## 5 · Actions and state verbs

Button labels, menu items, toast messages. Short and imperative.

| Term                 | Preferred form       | Notes                                                                       |
| -------------------- | -------------------- | --------------------------------------------------------------------------- |
| Log in / Log out     | Log in / Log out     | Two words as a verb. `Login` / `Logout` one word as a noun or adjective.    |
| Sign up              | Sign up              | Verb. `Signup` as noun or adjective.                                        |
| Set up               | Set up               | Verb. `Setup` as noun.                                                      |
| Back up              | Back up              | Verb. `Backup` as noun.                                                     |
| Upload / Download    | Upload / Download    | Verb and noun share the same form.                                          |
| Save / Delete / Edit | Save / Delete / Edit |                                                                             |
| Email                | Email                | One word as a noun and as a verb (`Email the link`). Capitalise as a label. |
| Send / Receive       | Send / Receive       |                                                                             |
| Add / Remove         | Add / Remove         |                                                                             |
| Enable / Disable     | Enable / Disable     |                                                                             |
| Publish / Unpublish  | Publish / Unpublish  |                                                                             |
| Archive / Restore    | Archive / Restore    |                                                                             |
| Approve / Reject     | Approve / Reject     |                                                                             |
| Duplicate            | Duplicate            | Not `Copy` for entities. `Copy` is for clipboard operations.                |

### Toast-message conventions

State-change confirmations follow a pattern. Past tense, no period, the noun comes first.

| Pattern            | Example              |
| ------------------ | -------------------- |
| `<Noun> <verb-ed>` | `Agent saved`        |
| `<Noun> <verb-ed>` | `Provider deleted`   |
| `<Noun> <verb-ed>` | `Workflow published` |

Strike `Successfully` — the toast is the success signal; the adverb is redundant.

---

## 6 · Deployment vocabulary

Terms that appear in install, operate, and configuration docs.

| Term              | Preferred form    | Notes                                                           |
| ----------------- | ----------------- | --------------------------------------------------------------- |
| Self-hosted       | Self-hosted       | Hyphenated adjective (`a self-hosted platform`).                |
| On-premises       | On-premises       | With final `s`. Never `on-premise`.                             |
| Open source       | Open source       | Two words, both as adjective (`open source platform`) and noun. |
| Zero-downtime     | Zero-downtime     | Hyphenated adjective.                                           |
| Blue-green        | Blue-green        | Hyphenated adjective.                                           |
| OpenAI-compatible | OpenAI-compatible | Hyphenated.                                                     |
| Air-gapped        | Air-gapped        | Hyphenated adjective.                                           |
| Data residency    | Data residency    | Two words. No hyphen.                                           |
| Reverse proxy     | Reverse proxy     | Two words. No hyphen as a noun.                                 |
| Health check      | Health check      | Two words as a noun.                                            |

---

## 7 · Role names

Tale's six roles are proper nouns: **Owner**, **Admin**, **Developer**, **Editor**, **Member**, **Disabled**.

- Capitalise when naming the role: `a Member can view chat history`.
- Lowercase when the word is generic: `members of your team use the app to…`.
- Never abbreviate — `Admin.` and `Mem.` are not acceptable.

---

## 8 · Style rules

- **Oxford comma** in lists of three or more.
- **Straight quotes** (`"..."`) everywhere — running prose, UI strings, and code blocks. Tale's English docs do not use typographic `"…"`; ASCII keeps grep simple.
- **Apostrophes:** straight ASCII `'` everywhere — contractions (`don't`), possessives (`Tale's`), and quoted strings.
- **En-dash** (`–`) for numeric ranges (`5–10 minutes`); **em-dash** (`—`) for parenthetical asides — like this.
- **ISO dates** (`2026-04-19`) in docs prose, log output, and frontmatter. Wall-clock times in the UI render through `useFormatDate()` and use the user's locale format.
- **12-hour clock** with lowercase `am`/`pm` in user-facing copy (`9 am`, `10:30 pm`). **24-hour** in technical contexts (cron expressions, server logs).
- **Verb/noun pairings** keep the two-word/one-word pattern — `set up` (verb) / `setup` (noun); `log in` (verb) / `login` (noun); `sign up` / `signup`; `back up` / `backup`.
- **Numbers under ten** in prose spelled out (`three providers`, `five steps`) except when paired with units (`5 GB`, `3 ms`).
- **Capitalisation in headings** is sentence case — not title case. `## Agent concepts`, not `## Agent Concepts`.

---

## Quick reference

| Question                                | Answer                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Knowledge Base` or `Knowledge base`?   | `Knowledge base` (sentence case in prose).                                                  |
| `Todo list` or `Research plan`?         | `Research plan` (product name).                                                             |
| `On-premise` or `On-premises`?          | `On-premises` (final `s`).                                                                  |
| Capitalise `Editor`?                    | When naming the role (`an Editor can upload`), yes. When generic (`a markdown editor`), no. |
| `it's easy to…`?                        | No. Strike the softener.                                                                    |
| `we recommend…`?                        | No. Replace with the imperative.                                                            |
| Toast: `Saved successfully` or `Saved`? | `Saved`. Strike the adverb.                                                                 |
| Numbers in prose?                       | Under ten: spell out. Ten and over, or with units: numeric.                                 |
