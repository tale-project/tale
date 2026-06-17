# Chat — Manual Test Plan

> **Purpose**: Exercise the AI chat module — messaging, the agent/model pickers,
> edit/branch/regenerate, attachments, the tool surface and write-op approval
> cards, reasoning/next-steps/human-input, memory proposals, arena mode, share
> links, and export. Write operations route through approvals; the agent reaches
> knowledge reads, sub-agents, document generation, and integration tools.

## Scope & routes

| Surface                   | Route                                       |
| ------------------------- | ------------------------------------------- |
| New chat                  | `/dashboard/{org}/chat`                     |
| Thread                    | `/dashboard/{org}/chat/{threadId}`          |
| Shared (public read-only) | `/dashboard/{org}/chat/shared/{shareToken}` |

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md), with a provider configured (or
mode A's mock). In **mode A** any prompt returns the canned reply and the
keyword triggers (`e2e:reasoning` / `e2e:nextsteps` / `e2e:humaninput` /
`e2e:error`) drive F18–F21. TL1–TL4 need real tool execution (live provider +
seeded knowledge), so they're best run in **mode B**.

> **Agent note**: a chat turn is done when **Send** re-enables (the Send⇄Stop
> toggle), not when text appears — wait on that. Delete threads by id, never by
> position. Mock canned reply lives in `packages/mocks/src/overrides/canned.ts`.

## Automated coverage

| Case(s)                              | Status                   | e2e spec                 |
| ------------------------------------ | ------------------------ | ------------------------ |
| F1–F4, F12                           | ✅ automated             | `chat-threads.spec.ts`   |
| F7–F10                               | ✅ automated             | `chat-advanced.spec.ts`  |
| F11, F13, F14, F15                   | ✅ automated             | `chat-features.spec.ts`  |
| AT1, F16                             | ✅ automated             | `chat-depth.spec.ts`     |
| F18–F22                              | ✅ automated (mock-only) | `chat-scenarios.spec.ts` |
| F17                                  | ✅ automated             | `search.spec.ts`         |
| F5, F6, F23, TL1–TL6, AT2–AT6, V1–V2 | ⛔ manual-only           | —                        |

## Functional tests

| ID  | Test            | Steps (route + control)                                                                                                                                 | Expected                                                                                                                                                              |
| --- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Chat loads      | Open `/dashboard/{org}/chat`                                                                                                                            | Composer, agent picker (`chat.agentSelector.label`), model picker, conversation starters                                                                              |
| F2  | Send a message  | Type a prompt, send                                                                                                                                     | Reply streams (canned in mode A); send disabled while composer empty                                                                                                  |
| F3  | New chat        | **New chat** (`chat.newChat`)                                                                                                                           | Fresh thread; prior thread under history (`chat.showHistory` → `chat.chatsSection`)                                                                                   |
| F4  | Title auto-gen  | First message in a new thread                                                                                                                           | Concise AI title (not "New Chat", not raw metadata)                                                                                                                   |
| F5  | Agent picker    | Open `chat.agentSelector.label`, pick another agent                                                                                                     | Selected agent drives the next turn                                                                                                                                   |
| F6  | Model picker    | Open the model selector, pick a model                                                                                                                   | Next turn uses it; **Auto** routes to the agent default                                                                                                               |
| F7  | Edit message    | Hover a sent message → `chat.moreActions` → edit (`chat.editMessage`) → **Send** (`chat.editSend`)                                                      | New branch; branch navigator appears (`chat.branchNavigator.next`)                                                                                                    |
| F8  | Stop generation | Send, then **Stop**                                                                                                                                     | Streaming halts; partial reply retained                                                                                                                               |
| F9  | Regenerate      | `chat.moreActions` → **Try again** (`chat.tryAgain`)                                                                                                    | New response branch on the same turn                                                                                                                                  |
| F10 | Copy reply      | Message actions → copy                                                                                                                                  | Text on clipboard; copied tooltip (`common.actions.copied`)                                                                                                           |
| F11 | Save as prompt  | `chat.savePromptMenu` → `chat.savePromptDraft` → fill (`prompts.form.contentLabel`) → **Save** (`prompts.form.save`)                                    | Prompt saved to library                                                                                                                                               |
| F12 | Prompt library  | `chat.savePromptMenu` → **Prompt library** (`chat.promptLibrary`)                                                                                       | Library lists the seeded `Summarize Text` prompt                                                                                                                      |
| F13 | Quote selection | Select assistant text → **Quote** (`chat.quote.button`)                                                                                                 | Quote chip in composer (`chat.quote.label`); removable (`chat.quote.remove`)                                                                                          |
| F14 | Feedback        | `chat.feedback.thumbsUp` / `thumbsDown` (+ comment `commentPlaceholder`)                                                                                | Feedback recorded                                                                                                                                                     |
| F15 | Export          | `chat.moreActions` → **Export** (`chat.export.button`) → `chat.export.title` → **Download markdown** / **PDF**                                          | File downloads; deselect-all (`chat.export.deselectAll`) works                                                                                                        |
| F16 | Share link      | `chat.share.button` → `chat.share.title` → enable (`chat.share.enableSharing`) → copy link (`chat.share.linkLabel`); **Preview** (`chat.share.preview`) | Read-only public view at `…/chat/shared/{token}`; **Fork** (`chat.share.forkChat`) clones it; disabling sharing revokes the link (404)                                |
| F17 | Search chats    | `chat.searchChat` → type message content (`dialogs.searchChat.placeholder`)                                                                             | Matching thread listed; selecting opens it                                                                                                                            |
| F18 | Reasoning       | Send a message containing `e2e:reasoning` (mode A)                                                                                                      | Thinking timeline discloses reasoning; collapsed by default, user-controlled                                                                                          |
| F19 | Next steps      | Send `e2e:nextsteps`                                                                                                                                    | `[[NEXT_STEPS]]` suggestion buttons render (`chat.structured.nextSteps`); clicking one sends it                                                                       |
| F20 | Human input     | Send `e2e:humaninput`                                                                                                                                   | `request_human_input` card (`humanInputRequest.questionTitle`); answer → **Submit** (`humanInputRequest.submit`) → `statusResponded`                                  |
| F21 | Provider error  | Send `e2e:error`                                                                                                                                        | Friendly error (`chat.errorGenerating`) + Retry — not a crash                                                                                                         |
| F22 | Arena           | `composer.openMenu` → **Arena** (`chat.arena.label`); pick model A/B; send                                                                              | Two columns respond; verdict bar (`chat.arena.verdictLabel`); **A is better** (`chat.arena.aBetter`) → `chat.arena.verdictRecorded`                                   |
| F23 | Memory proposal | In mode B, say something worth remembering ("remember that I prefer metric units")                                                                      | An inline memory-proposal card appears; accept/dismiss it. The decision is auditable under Governance → Trash → **Memory audit** (`governance.trash.tab.memoryAudit`) |

### Attachments

| ID  | Test               | Input                                     | Expected                                                           |
| --- | ------------------ | ----------------------------------------- | ------------------------------------------------------------------ |
| AT1 | PDF/DOCX           | Attach a small doc, ask about it          | File chip in the bubble (no raw `(fileId: …)` leak); agent uses it |
| AT2 | Image              | Attach a PNG/JPEG                         | Preview renders; vision model can describe it                      |
| AT3 | Duplicate in batch | Attach the same file twice before sending | Second rejected with a duplicate toast                             |
| AT4 | Too many files     | Attach 11 files                           | Rejected — max 10 per message                                      |
| AT5 | Oversized          | Attach a file > 100 MB                    | Rejected with a size toast                                         |
| AT6 | Attachment-only    | Attach a file, send with no text          | Sends; thread title derives from the file name                     |

### Tool surface & approvals

| ID  | Test                 | Prompt                                               | Expected                                                                 |
| --- | -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| TL1 | Knowledge read       | Ask about a seeded product/customer                  | `product_read`/`customer_read` runs; tool card shows the call            |
| TL2 | RAG                  | Ask about an uploaded document                       | `rag_search` runs; answer cites the document                             |
| TL3 | Web scope            | Ask something only on a crawled org website          | `web_assistant` searches org sites, not the open web                     |
| TL4 | Doc generation       | "Generate a one-page PDF of …"                       | `pdf` tool returns a downloadable file part                              |
| TL5 | Write needs approval | Ask the agent to create/update a record              | Approval card raised; write does NOT apply until approved (then it does) |
| TL6 | Feature flag         | Disable web search for your role, ask a web question | Tool refused server-side; no web call                                    |

### Voice

| ID  | Test          | Steps                      | Expected                                    |
| --- | ------------- | -------------------------- | ------------------------------------------- |
| V1  | Dictation     | Mic → speak → stop         | Transcript inserted into the composer       |
| V2  | Stops on send | Start dictation, then send | Mic stops on send — does not keep listening |

## Accessibility (WCAG 2.1 AA)

| ID  | Check               | Expected                                                 |
| --- | ------------------- | -------------------------------------------------------- |
| A1  | Keyboard send       | Enter sends; Shift+Enter newlines                        |
| A2  | Streaming announced | New assistant text exposed via `aria-live`               |
| A3  | Focus order         | composer → attach → pickers → send, sensibly             |
| A4  | Mic labelled        | Dictation button has an accessible name + `aria-pressed` |

## Performance

| ID  | Metric            | Target                                        |
| --- | ----------------- | --------------------------------------------- |
| P1  | TTFT              | First token < 3 s warm (live); ~150 ms (mock) |
| P2  | Attachment upload | Small PDF uploads + chips in < 3 s            |
| P3  | Thread switch     | Opening a history thread renders < 1 s        |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Chat
Functional: ___/23   Attachments: ___/6   Tools: ___/6   Voice: ___/2   A11y: ___/4   Perf: ___/3
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
