# Chat Testing Guide (AI-Directed)

> **Purpose**: Exercise the AI chat module — message flow, attachments, the agent/model pickers, the tool surface, arena mode, and voice/dictation — and collect defects in Issues Found. The chat agent reaches a broad tool surface (knowledge reads, sub-agents, document generation, integrations); write operations route through approvals.

## Prerequisites

Bring the stack up per [FULL_SITE_TESTING.md](FULL_SITE_TESTING.md) and sign in as `admin@admin.test` / `Admin@123`. At least one **model provider** must be configured (Settings → Providers) for the AI to respond — if none is set, F2 and the tool tests will fail with a provider error rather than a chat bug; note that distinction.

> **AI Instructions**: Run in order; one finding per defect in Issues Found with a screenshot. Capture **TTFT** (time to first token) where asked. A "Something went wrong" with a Retry button is the friendly error path, not a crash.

## Screenshot Setup

```bash
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)/chat
```

## Functional tests

| ID  | Test                  | Steps                                            | Expected                                                            |
| --- | --------------------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| F1  | Chat loads            | Open `/dashboard/{id}/chat`                      | Composer, agent picker, model picker, conversation starters render  |
| F2  | Send a message        | Type "Reply with the single word ready", send    | Response streams; send button disabled while empty                  |
| F3  | New chat              | Click "New chat"                                 | Fresh thread; previous one preserved in history                     |
| F4  | Thread title auto-gen | Send a first message in a new thread             | Thread gets a concise AI title (not "New Chat", not raw metadata)   |
| F5  | Agent picker          | Open the agent selector, pick a different agent  | Selected agent drives the next turn                                 |
| F6  | Model picker          | Open the model selector, pick a model            | Next turn uses it; "Auto" routes to the agent default               |
| F7  | Edit a message        | Hover a sent user message → Edit → change → save | A branch is created; latest edit is shown; branch navigator appears |
| F8  | Stop generation       | Send a long prompt, click Stop                   | Streaming halts; partial response retained                          |
| F9  | Copy / save-as-prompt | Use the message actions on an assistant reply    | Copy puts text on clipboard; save-prompt opens the prompt save flow |

## Attachment tests

| ID  | Test                        | Input                                             | Expected                                                                       |
| --- | --------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------ |
| AT1 | Attach a PDF/DOCX           | Attach a small document, send a question about it | File chip shows in the bubble (no raw `(fileId: …)` text leaks); agent uses it |
| AT2 | Attach an image             | Attach a PNG/JPEG                                 | Image preview renders; vision-capable model can describe it                    |
| AT3 | Duplicate file in one batch | Attach the same file twice before sending         | Second attach rejected with a "duplicate file" toast                           |
| AT4 | Too many files              | Attach 11 files                                   | Rejected — max 10 per message                                                  |
| AT5 | Oversized file              | Attach a file > 100 MB                            | Rejected with a size toast                                                     |
| AT6 | Attachment-only message     | Attach a file, send with no text                  | Sends; thread title derives from the file name, not metadata (#1468)           |

## Tool-surface tests

The chat agent exposes knowledge reads (`customer_read`, `product_read`, `rag_search`, `context_search`), sub-agents (`web_assistant`, `document_assistant`, `integration_assistant`, `workflow_assistant`), document generation (`pdf`, `image`, `docx`, `pptx`, `generate_excel`), and integration tools (`integration`, `integration_batch`, `integration_introspect`, `verify_approval`). Governance feature flags can disable web search / code execution / file upload per scope.

| ID  | Test                    | Prompt                                               | Expected                                                             |
| --- | ----------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| TL1 | Knowledge read          | Ask about a seeded product/customer                  | Agent calls `product_read`/`customer_read`; tool card shows the call |
| TL2 | RAG over documents      | Ask about an uploaded document's content             | `rag_search` runs; answer cites the document                         |
| TL3 | Web search scope        | Ask something only on a crawled org website          | `web_assistant` searches org sites only (not the open internet)      |
| TL4 | Document generation     | "Generate a one-page PDF summary of …"               | `pdf` tool produces a downloadable file part in the reply            |
| TL5 | Write op needs approval | Ask the agent to create/update a record              | An approval is raised; the write does not apply until approved       |
| TL6 | Feature flag enforced   | Disable web search for your role, ask a web question | Tool refused server-side; no web call                                |

## Arena & voice tests

| ID  | Test                    | Steps                                  | Expected                                                         |
| --- | ----------------------- | -------------------------------------- | ---------------------------------------------------------------- |
| AR1 | Arena mode              | Start Arena, send a prompt             | Two threads (A/B) respond side by side; verdict controls show    |
| AR2 | Arena verdict merge     | Pick "B is better"                     | B's messages merge into A; other verdicts keep A (B discarded)   |
| V1  | Dictation start/stop    | Click the mic, speak, click stop       | Transcript inserted into the composer                            |
| V2  | Dictation stops on send | Start dictation, then send the message | Mic recording stops on send — it does not keep listening (#1462) |

## Accessibility tests (WCAG 2.1 AA)

| ID  | Check               | Expected                                                          |
| --- | ------------------- | ----------------------------------------------------------------- |
| X1  | Keyboard send       | Compose + Enter sends; Shift+Enter newlines                       |
| X2  | Streaming announced | New assistant text is exposed via an `aria-live` region           |
| X3  | Focus order         | Tab cycles composer → attach → pickers → send in a sensible order |
| X4  | Mic button labelled | Dictation button has an accessible name + `aria-pressed` state    |

## Performance tests

| ID  | Metric               | Target                                 |
| --- | -------------------- | -------------------------------------- |
| P1  | TTFT (simple prompt) | First token < 3 s with a warm provider |
| P2  | Attachment upload    | A small PDF uploads + chips in < 3 s   |
| P3  | Thread switch        | Opening a history thread renders < 1 s |

## Issues Found

| #   | Test ID | Page / URL | Severity | Description | TTFT (if applicable) | Screenshot |
| --- | ------- | ---------- | -------- | ----------- | -------------------- | ---------- |
|     |         |            |          |             |                      |            |

## Test summary

```
Module: Chat
Functional: ___/9   Attachments: ___/6   Tools: ___/6   Arena+Voice: ___/4   A11y: ___/4   Perf: ___/3
Issues found: ___ (crit __ / high __ / med __ / low __)
TTFT median: ___ s
Status: PASS / FAIL
```
