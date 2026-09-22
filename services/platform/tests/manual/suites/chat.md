# Chat

> **Prefix** `CHAT-` · **Reset** none · **Cost** 76 boxes

Exercise the AI chat surface — the welcome view, messaging and the composer
(model + reasoning-effort picker, attachments, dictation, voice output),
edit/branch/regenerate/stop, the thought timeline and source cards, share
links and forking, arena mode, the thread history panel, and the degraded
states (backend unavailable, no provider, budget exceeded). There is **no
agent picker** anymore: the composer picks a **model** and a reasoning effort;
agents, skills, and connectors are equipped per **project** (see
[projects.md](projects.md)), not in chat.

## Scope & routes

| Surface                   | Route                                       |
| ------------------------- | ------------------------------------------- |
| New chat                  | `/dashboard/{org}/chat`                     |
| Thread                    | `/dashboard/{org}/chat/{threadId}`          |
| Shared (public read-only) | `/dashboard/{org}/chat/shared/{shareToken}` |

(`{threadId}` and `{shareToken}` are produced at runtime by sending a first
message / enabling sharing — there is no static URL for them.)

## Preconditions

Stack up + signed in per [SETUP.md](../setup.md), with a provider configured
(or mode A's mock). In **mode A** any prompt returns the canned reply and the
keyword triggers (`e2e:reasoning` / `e2e:nextsteps` / `e2e:humaninput` /
`e2e:error`) drive CHAT-F16–CHAT-F19. Rows marked **mode B** need a live
provider; CHAT-F25 additionally needs a TTS-capable model,
CHAT-F26/CHAT-AT7 an available organization audio transcription model, and CHAT-F32–CHAT-F33 a
successfully indexed document (RAG indexing needs the full Docker stack — it
fails under `TALE_DEV_SKIP_DOCKER=1`).

The canvas / code-artifact surface has **no live UI right now** — its residual
i18n keys were pruned in #2919 — so this guide carries no canvas cases.

> **Agent note**: a chat turn is done when **Send** re-enables — Send and Stop
> share one slot (**Stop generating** `chat.stopGenerating`, interim
> **Stopping…** `chat.stoppingGeneration`); poll for Stop to disappear, never
> for text. Sending the first message redirects to `/chat/{threadId}` (a 16+
> char id); key all later selectors on that id, never the auto-generated
> title. A blocked send states its reason as a tooltip on the disabled Send
> button and as a destructive toast on Enter. `e2e:error` deliberately logs an
> induced provider error to the console — that is the designed 500 path, not a
> chat bug. The mock's canned payloads live in `lib/mocks/overrides/canned.ts`
> (relative to the platform dir).

## Functional tests

- [ ] `CHAT-F1` · **Welcome view loads** — Open `/dashboard/{org}/chat` →
  Status 200; heading **What are we working on?** (`chat.welcomeEmpty`); a
  list of four conversation starters (`chat.starters.email`,
  `chat.starters.summarize`, `chat.starters.brainstorm`,
  `chat.starters.explain`); the composer with placeholder **Ask about your
  documents or the web…** (`chat.placeholder`) and the model picker
  (`chat.picker.ariaLabel`)
- [ ] `CHAT-F2` · **Starter sends first message** — On the welcome view click
  a starter, e.g. **Help me write a clear, professional email**
  (`chat.starters.email`) → The starter text is sent as the first message; URL
  becomes `/dashboard/{org}/chat/{threadId}`; a reply streams (canned in mode
  A)
- [ ] `CHAT-F3` · **Send a message** — Type a prompt in the message input
  (`chat.aria.chatInput`), press **Enter** (or click **Send message**
  `chat.send`) → URL becomes `/dashboard/{org}/chat/{threadId}`; an assistant
  reply renders; **Stop generating** (`chat.stopGenerating`) replaces Send
  while streaming, then Send returns.
- [ ] `CHAT-F4` · **New chat + history panel** — Open the chats panel (**Show
  chats** `chat.showHistory` / **Hide chats** `chat.hideHistory`); click **New
  chat** (`chat.newChat`) → URL returns to `/dashboard/{org}/chat` (no thread
  id); the prior thread is listed under **Chats** (`chat.chatsSection`); an
  org with projects also shows **Projects** (`chat.projectsSection`)
- [ ] `CHAT-F5` · **Title auto-generation** — Send the first message in a new
  thread, then reload → The thread's history entry shows a generated title —
  not **Untitled chat** (`chat.history.untitled`); the title persists after
  reload.
- [ ] `CHAT-F6` · **Model picker** — Open the combined picker (trigger
  `chat.picker.ariaLabel` = "Choose model and reasoning effort"); search
  (`chat.picker.searchPlaceholder`); pick a model under the **Model** section
  (`chat.picker.sectionModel`) → The trigger shows the chosen model's name
  (falls back to **Select model** `chat.modelSelector.label` with none); a
  non-matching search shows **No matches** (`chat.picker.searchEmpty`); the
  next turn runs on the chosen model (check via CHAT-F13's info dialog)
- [ ] `CHAT-F7` · **Reasoning effort** — With a reasoning-capable model
  selected, open the picker → **Reasoning effort** (`chat.effort.label`) →
  pick **High** (`chat.effort.high`); reload `/dashboard/{org}/chat` → The
  trigger shows the effort as a muted suffix; **Max** (`chat.effort.max`)
  carries the hint `chat.effort.maxHint`; after reload a fresh composer seeds
  from the saved pick (device-persisted, per org); a model without reasoning
  shows no effort section.
- [ ] `CHAT-F8` · **Edit message → branch** — Hover a sent user message →
  **Edit message** (`chat.editMessage`) → change the text → **Send**
  (`chat.editSend`) → A new branch is created; the branch navigator appears
  with **Previous branch** / **Next branch** (`chat.branchNavigator.previous`,
  `chat.branchNavigator.next`) and a position indicator.
- [ ] `CHAT-F9` · **Regenerate** — On an assistant message click **Try again**
  (`chat.tryAgain`) → A new response branch is added to the same turn; the
  branch navigator shows >1 branch.
- [ ] `CHAT-F10` · **Stop generation** — Send, then click **Stop generating**
  (`chat.stopGenerating`) while it streams → The button shows **Stopping…**
  (`chat.stoppingGeneration`) then Send returns; the partial reply is retained
  with a **Generation stopped** annotation (`chat.generationStopped`)
- [ ] `CHAT-F11` · **Copy reply** — Assistant toolbar → **Copy**
  (`common.actions.copy`) → The tooltip flips to **Copied**
  (`common.actions.copied`); the clipboard holds the reply as normalized plain
  text (no stray blank lines)
- [ ] `CHAT-F12` · **Feedback** — **Helpful** (`chat.feedback.thumbsUp`) /
  **Not helpful** (`chat.feedback.thumbsDown`) → comment field (placeholder
  `chat.feedback.commentPlaceholder`) → **Submit**
  (`chat.feedback.submitComment`) → The chosen control latches
  (`aria-pressed`); the choice survives a reload of the thread.
- [ ] `CHAT-F13` · **Message info dialog** — Assistant toolbar → **Show info**
  (`common.actions.showInfo`) → The **Message information** dialog
  (`chat.messageInfo.title`) opens showing **Model**
  (`chat.messageInfo.model`), **Token usage** (`chat.messageInfo.tokenUsage`),
  and **Start → first token** (`chat.messageInfo.timeToFirstToken`); the model
  line matches the CHAT-F6 pick.
- [ ] `CHAT-F14` · **Fork chat** — Assistant toolbar → **Fork chat**
  (`chat.forkChat`) → A toast **Chat forked successfully**
  (`chat.forkSuccess`); a new thread opens titled **Fork of {title}**
  (`chat.forkOf`) containing the messages up to the fork point.
- [ ] `CHAT-F15` · **Quote selection** — Select text inside an assistant
  message → floating **Quote** (`chat.quote.button`) → A **Quoted** chip
  (`chat.quote.label`) appears over the composer; **Remove quote**
  (`chat.quote.remove`) clears it; on send the quote is prepended to the
  message as a markdown blockquote.
- [ ] `CHAT-F16` · **Thought timeline** — Mode A: send a message containing
  `e2e:reasoning` → While live the header reads **Thinking**
  (`chat.thinking.label`) with ticking seconds; settled it reads **Thought for
  {seconds}s** (`chat.thinking.done`) and stays; tool steps (**Called {tool}**
  `chat.parts.toolCall`) are always visible; expanding the header
  (user-controlled, never automatic) reveals the reasoning prose; the answer
  text never renders inside the timeline.
- [ ] `CHAT-F17` · **Next steps** — Mode A: send `e2e:nextsteps` → A
  **Suggested follow-ups** section (`chat.structured.nextSteps`) renders
  suggestion buttons; clicking one sends it as a new turn.
- [ ] `CHAT-F18` · **Human input request** — Mode A: send `e2e:humaninput` →
  While the question is outstanding the composer carries it (the question
  panel, or its collapsed bar) and the response-status region
  (`chat.generation.regionLabel`) reads **Waiting for your answer**
  (`chat.generation.waitingInput`); the transcript shows NO second copy of
  the live question. Once resolved, a timeline row with the question appears
  as the marker of the ask — the answer itself is your next message below
  it, unlabelled; a skipped question carries the badge **Skipped**
  (`chat.parts.humanInputSkipped`), and several questions read as
  `chat.parts.humanInputAndMore`
- [ ] `CHAT-F19` · **Provider error** — Mode A: send `e2e:error` → A friendly
  **Something went wrong** error (`chat.errorGenerating`) with a **Technical
  details** disclosure (`chat.errorDetailsSummary`) and **Try again**
  (`chat.retryGeneration`) renders — the app does not crash (the console's
  induced-provider-error line is expected)
- [ ] `CHAT-F20` · **Export** — Thread header **Conversation actions**
  (`chat.aria.threadActions`) → **Export** (`chat.export.button`) → The
  **Export chat** dialog (`chat.export.title`) opens; **Deselect all**
  (`chat.export.deselectAll`) / **Select all** (`chat.export.selectAll`)
  toggle the per-message checkboxes; **Download Markdown**
  (`chat.export.downloadMarkdown`) saves a file; **Print to PDF**
  (`chat.export.downloadPdf`) opens the print flow; with none selected both
  are disabled.
- [ ] `CHAT-F21` · **Share link** — **Share** (`chat.share.button`) → dialog
  **Share chat** (`chat.share.title`) → under **Who can view this chat**
  (`chat.share.accessPickerLabel`) pick **Share with organization**
  (`chat.share.organizationLink`; **Keep private**, `chat.share.keepPrivate`,
  is the default) → **Create share link** (`chat.share.createLink`) →
  **Copy link** (`chat.share.copyLink`) → **Preview** (`chat.share.preview`)
  → The link copies with confirmation **Link copied**
  (`chat.share.copied`); Preview opens
  `/dashboard/{org}/chat/shared/{shareToken}`; the thread row gains the
  **Shared** indicator (`chat.share.sharedIndicator`)
- [ ] `CHAT-F22` · **Shared view + stop sharing** — Open the share URL in a
  private window; then in the owner session use the thread-row menu → **Stop
  sharing** (`chat.share.unshare`); reload the private window → The shared
  page is read-only — header **Shared chat** (`chat.share.sharedChat`), byline
  `chat.share.byline`, no composer; after unsharing the same URL shows **This
  shared chat is no longer available.** (`chat.share.notFound`)
- [ ] `CHAT-F23` · **Republish newer messages** — With sharing on, send
  another message in the thread; reopen the Share dialog → The dialog reads
  **Newer messages aren't included.** (`chat.share.snapshotHintShared`) and
  offers **Include newer messages** (`chat.share.includeNewer`); before
  clicking it the shared view lacks the new message; after clicking it and
  reloading, the shared view includes it.
- [ ] `CHAT-F24` · **Arena mode** — **Open chat menu** (`composer.openMenu`) →
  under **Modes** (`composer.modeHeader`) pick **Arena Mode**
  (`chat.arena.label`); pick **Model A** / **Model B**
  (`chat.arena.modelALabel`, `chat.arena.modelBLabel`); send → Two columns
  respond; the verdict bar shows **Choose a verdict**
  (`chat.arena.verdictLabel`); a verdict before both replies finish is refused
  (`chat.arena.busy`); **A is better** (`chat.arena.aBetter`) records with
  **Verdict recorded** (`chat.arena.verdictRecorded`); the Share dialog for an
  arena thread refuses (`chat.share.notShareable` /
  `chat.share.cannotShareArena`)
- [ ] `CHAT-F25` · **Voice output (TTS)** — Toggle the composer's **Voice
  mode** (`chat.voice.voiceModeLabel`, `aria-pressed`; tooltips
  `chat.voice.voiceModeEnable` / `chat.voice.voiceModeDisable`); send (**mode
  B**, TTS-capable provider). Or per message: **Speak out loud**
  (`chat.speakOutLoud`) → The reply is spoken — **Speaking** indicator
  (`chat.voice.voiceOutputSpeaking`) with **Stop voice output**
  (`chat.voice.voiceOutputStop`); the per-thread toggle survives a reload.
  Without a TTS model the toggle's tooltip reads
  `chat.voice.voiceOutputErrorConfig` — itself a checkable outcome in mode A.
- [ ] `CHAT-F26` · **Dictation (MediaRecorder)** — In a browser without
  SpeechRecognition, allow microphone access and click **Start dictation**
  (`chat.dictation.start`) → speak → **Stop dictation**
  (`chat.dictation.stop`) (**mode B**, available organization audio model) →
  While recording a level meter (`chat.dictation.level`) shows; after stop,
  **Transcribing…** (`chat.dictation.transcribing`) then the transcript lands
  in the input. A failed recording offers retry and **Discard recording**
  (`chat.dictation.discard`). Sending while recording stops the mic. A known
  unavailable server model explains the reason before recording and cannot
  start MediaRecorder; with no candidate it reads `chat.transcription.noModel`.
- [ ] `CHAT-F27` · **Pin / rename / unread** — Thread-row **More actions**
  (`chat.moreActions`) → **Pin chat** (`chat.pinChat`); **Rename**
  (`chat.history.renameChat`); **Mark as unread** (`chat.markAsUnread`) → The
  pinned thread shows the **Pinned** marker (`chat.pinned`) and sorts to the
  top (**Unpin chat** `chat.unpinChat` reverses); the new name persists after
  reload; an unread thread shows its unread affordance until **Mark as read**
  (`chat.markAsRead`) or opening it.
- [ ] `CHAT-F28` · **Archive / unarchive** — Thread-row menu → **Archive**
  (`chat.archive`); open the archived thread; unarchive → Toast **Chat
  archived** (`chat.archiveSuccess`); the thread moves under **Archived**
  (`chat.archived.title`); opening it replaces the composer with the banner
  **This conversation was archived** (`chat.archivedBanner`) and an
  **Unarchive** action (`chat.unarchive`); unarchiving restores the composer.
- [ ] `CHAT-F29` · **Delete chat** — Thread-row menu → **Delete chat**
  (`chat.deleteChat`) → confirm (`chat.deleteConfirmation`) → The dialog
  explains trash + grace period (`chat.deletePermanentMessage`); after
  confirming the thread leaves the list; opening its old URL shows **This chat
  is not available.** (`chat.notFound`)
- [ ] `CHAT-F30` · **Search chats** — Panel **Search chats**
  (`chat.searchPalette.title`) → type message content into the dialog
  (placeholder `chat.searchPalette.placeholder`); switch scope to
  **Everything** (`dialogs.search.scopeEverything`) without closing → The
  matching thread is listed under Chats (no match: `chat.searchPalette.noResults`);
  selecting it navigates to `/dashboard/{org}/chat/{threadId}`. The same
  palette stays open; **Everything** also covers projects, tasks, documents,
  and contacts (`dialogs.search.title`).
- [ ] `CHAT-F31` · **Move to project** — Thread-row menu → **Move to
  project…** (`chat.moveToProject`) → pick a project (create one first via
  **New project** `chat.newProject` if none) → The thread relocates under the
  project's folder in the panel; **Remove from project**
  (`chat.removeFromProject`) returns it to **Chats**; both survive a reload.
- [ ] `CHAT-F32` · **Source cards** — **Mode B + Docker stack**: ask about an
  uploaded + indexed document (or a fetched web page) so the turn actually
  loads sources → A **Sources** row (`chat.sources.label`) renders one card
  per fetched page/document — derived from tool results, never from prose;
  beyond 3 they fold behind **Show all {count} sources**
  (`chat.sources.showAll`) / **Hide sources** (`chat.sources.hide`); web cards
  open in a new tab, document cards open the in-app preview.
- [ ] `CHAT-F33` · **Citations** — **Mode B + Docker stack**: same setup as
  CHAT-F32 with a RAG-citing answer → Inline **Source {number}** buttons
  (`chat.citations.source`) render; the popover shows **Page {page}**
  (`chat.citations.page`) and **View in document**
  (`chat.citations.viewDocument`) for documents, **Visit page**
  (`chat.citations.visitPage`) for web sources.
- [ ] `CHAT-F34` · **Step-limit notice** — **Mode B**: give a tool-heavy task
  that exhausts the turn's tool-round budget (many sequential lookups) → The
  turn ends with a neutral info line **Stopped here — this turn reached its
  step limit. Send a message to continue.** (`chat.stepLimitReached`) — an
  info note, not a warning; sending another message continues normally.
- [ ] `CHAT-F35` · **Write-op approval row** — **Mode B**: ask the agent to
  create/update an org record (a write that requires approval) → The turn
  renders an approval row with the question and badge **Approval requested**
  (`chat.parts.approvalPending`); the status region reads **Waiting for your
  approval** (`chat.generation.waitingApproval`); after resolution the badge
  flips (`chat.parts.approvalApproved` / `chat.parts.approvalRejected`) and
  the write is verifiable in the target list.
- [ ] `CHAT-F36` · **Project-thread scope** — **Mode B + Docker stack**: in a
  project holding one indexed file and one text file bound over the REST API
  without indexing (its row on the project's **Files** tab reads **Not
  indexed** `projects.files.ragStatusNotIndexed` and offers **Index now**
  `projects.files.indexingStart`), open a chat inside the project and ask to
  list the project's documents, then to read the unindexed text file; then
  ask the same in the organization chat → In the project chat the listing
  step (`chat.thinking.listing.documents`) returns the project's files beside
  the hub's, each marked with its scope and indexing, and the read step names
  the file (`chat.thinking.readingDocument`) and the reply quotes its text; no
  other project is listed or searched. In the organization chat the listing
  returns hub files only and the assistant points at the project's own chat
  instead of walking the project list.
- [ ] `CHAT-F37` · **Confidentiality notice** — With the org's notice on and
  an English text saved (governance.md `GOV-F19`), open a new chat, send a
  message, then archive the thread; in a second tab, turn the notice off →
  Under the composer a note labelled **Confidentiality notice**
  (`dataNotice.footer.ariaLabel`) reads the saved text on the new chat and in
  the thread; the archived thread, whose banner replaces the composer, shows
  no note; after the switch turns off, an open chat drops the note without a
  reload.
- [ ] `CHAT-F38` · **Sticky pick keeps its provider** — With two providers
  listing the same model id (a shipped provider plus a custom provider on
  another endpoint of the same vendor, settings.md `SET-F43`), open the picker
  → each provider is its own section headed by its display name; pick the id
  under the custom provider, send, then reload `/dashboard/{org}/chat` → The
  trigger seeds the same model and the next turn runs on the custom provider
  (CHAT-F13's info dialog names it), never on the shipped copy of the id.
- [ ] `CHAT-F39` · **Send always snaps the new message to the top** — Open a
  thread you visited before and send within a second of it appearing; then
  scroll to the bottom with a trackpad and send again while the momentum tail
  is still running, pointer resting over the messages → Both sends glide the
  new message to just under the header and the reply streams beneath it; no
  **Scroll to bottom** button flashes during the glide.
- [ ] `CHAT-F40` · **Scroll to bottom follows a streaming reply** — Ask for a
  long reply, scroll up while it streams, then press **Scroll to bottom**
  (`chat.scrollToBottom`) → The view lands at the bottom and keeps following
  the growing reply; a wheel or trackpad scroll up stops the follow and the
  button returns.
- [ ] `CHAT-F41` · **A tool-using reply keeps its thought timeline when the
  turn settles** — Mode B, in a project with a web or knowledge tool
  equipped: ask something the model answers with tool steps and a long
  answer (a live weather lookup, a document search), and watch the reply as
  the stream ends → Anything the model wrote before a tool call is on screen
  while that tool runs; the **Thought for Ns** header (`chat.thinking.done`)
  and its step rows stay put; the answer body never jumps up and back down
  when the turn settles, no paragraph pops in above it, and the steps are
  still there once the reply is done.
### Attachments
- [ ] `CHAT-AT1` · **Attach a document** — **Open chat menu**
  (`composer.openMenu`) → **Add photos & files** (`composer.addFiles`) → pick
  a small PDF; send → While uploading the chip shows **Uploading…**
  (`chat.uploadingFile`) with **Cancel upload** (`chat.cancelUpload`); Send is
  held until the upload lands; the sent turn shows the filename chip (no MIME,
  no "Attachment:" prefix; long names truncate with full name on hover);
  **Remove attachment** (`chat.removeAttachment`) works before send. Mode B:
  the agent can use the content.
- [ ] `CHAT-AT2` · **Attach an image** — Attach a PNG/JPEG → An image chip
  (**View image** `chat.viewImage`) renders; clicking the sent image opens the
  lightbox (`chat.imagePreview`); with a non-vision model selected the notice
  `chat.modelCannotSeeImages` appears.
- [ ] `CHAT-AT3` · **Paste an image** — Copy an image to the clipboard, paste
  into the message input → The paste attaches the image (named
  `pasted-image-1.png`; repeated pastes number up) instead of inserting text;
  the chip behaves like CHAT-AT2.
- [ ] `CHAT-AT4` · **Duplicate in batch** — Attach the same file twice before
  sending → The second is rejected with a **Duplicate file** toast
  (`chat.duplicateFile`, description `chat.duplicateFileDescription`); only
  one chip remains.
- [ ] `CHAT-AT5` · **Too many files** — Attach 11 files → Rejected at the
  10-per-message cap — a **Too many files** toast (`chat.tooManyFiles`,
  description `chat.tooManyFilesDescription`) reports the rejected count.
- [ ] `CHAT-AT6` · **Oversized** — Attach a non-media file > 100 MB (or push
  the batch past 200 MB total; or audio/video > 4 h) → Rejected with the
  matching toast — `chat.fileSizeExceededMultiple`, **Attachments too large**
  (`chat.totalSizeExceeded`), or `chat.audioDurationExceeded`; no chip is
  added.
- [ ] `CHAT-AT7` · **Audio transcription** — **Mode B** (transcription-capable
  provider): attach an audio file → The chip shows **Transcribing…**
  (`chat.transcription.transcribing`); a Send meanwhile is deferred, the tray
  reading **Queued — sends when the attachments are ready**
  (`chat.deferredSend.waiting`) and going out on its own once the
  transcript lands; then **Transcribed**
  (`chat.transcription.transcribed`). In the sent message, **View transcript**
  (`chat.transcription.viewTranscript`) opens the text — it stays off the message
  bubble; a failure shows `chat.transcription.couldNotTranscribe` with **Try
  again** (`chat.transcription.retry`)
- [ ] `CHAT-AT8` · **Attachment-only send** — Attach a file, send with no text
  → The message sends — staged attachments make an empty field sendable; the
  turn renders with the file part only.
- [ ] `CHAT-AT9` · **Queued send fires** — Attach a large document and press
  Send while its chip still reads **Indexing…** (`chat.indexing`) → The tray
  row reads **Queued — sends when the attachments are ready**
  (`chat.deferredSend.waiting`) with the chip's live progress; the moment
  the reply starts streaming, the row leaves the tray and the sent message
  appears in the transcript above the reply — not when the reply ends. The
  same thread open in a second tab shows the same flip; a tab that reopens
  the thread mid-reply shows the message, no tray row.
- [ ] `CHAT-AT10` · **Code file with no MIME type** — Attach a source file the
  OS types as nothing — a **.cjs**, **.go** or **.sh** — let **Indexing…**
  (`chat.indexing`) finish, then send → The turn goes out: the composer clears,
  the chip rides the sent message, and the reply arrives. The composer must NOT
  keep the text and the chip behind a **Send failed** toast
  (`chat.toast.sendFailed`) while a `Thinking · Ns` shell hangs over a
  transcript that a reload then shows empty.

## Boundary & error tests

- [ ] `CHAT-B1` · **Empty composer** — Empty or whitespace-only input → **Send
  message** (`chat.send`) is disabled; Enter no-ops.
- [ ] `CHAT-B2` · **Very long message** — Mode A: paste a ~20k-character
  message, send → The message sends without freezing the UI; the bubble
  renders; the thread stays scrollable and the **Scroll to bottom** button
  (`chat.scrollToBottom`) appears when scrolled up.
- [ ] `CHAT-B3` · **Markdown edge cases** — Mode B (mode A's reply is fixed):
  ask for nested lists, a wide table, code fences, and LaTeX → Nested lists
  (≥3 levels) and code fences render; a wide table stays usable in a
  horizontal-scroll wrapper. **LaTeX is NOT rendered** — the renderer ships
  only `remark-gfm`, so `$$…$$` / `$…$` show verbatim (see Issues #1)
- [ ] `CHAT-B4` · **Network drop mid-stream** — Mode A: go offline while a
  reply streams → A friendly error (`chat.errorGenerating`) or a send-failure
  toast (`chat.toast.sendFailed`) renders, no crash; **Try again**
  (`chat.retryGeneration`) works after reconnect.
- [ ] `CHAT-B5` · **Rapid send/stop/send** — Mode A: send → **Stop
  generating** (`chat.stopGenerating`) immediately → send again → No duplicate
  turn is created; the composer/Send state stays consistent.
- [ ] `CHAT-B6` · **Budget exceeded** — Set a low budget rule (see
  [governance.md](governance.md)), chat past it; **delete it after** →
  Approaching the cap a banner shows the remainder (`chat.budgetRemaining`)
  with **Dismiss** (`chat.budgetWarningDismiss`); exceeded, the banner turns
  destructive and reads `chat.budgetLimitReached` (the used-of-limit figures,
  `chat.budgetExceededDetail`, sit in its hover title) with **View usage**
  (`chat.budgetViewUsage`) and **Request usage credits**
  (`chat.budgetRequestCredits` → `chat.budgetRequestCreditsSent`); Send is
  blocked with reason `chat.budgetExceededDefault` (tooltip on the disabled
  button; destructive toast on Enter); a server-side refusal titles
  `chat.toast.budgetExceeded` with `chat.errorHintBudgetExceeded` below it
- [ ] `CHAT-B7` · **Backend unavailable** — Stop the chat backend while the
  app is open (e.g. kill the dev backend process), open a thread → The surface
  shows **Chat isn't connected yet** (`chat.backendUnavailable.title`) with
  `chat.backendUnavailable.description` instead of a crash or endless spinner;
  drafts are not lost (the draft persists per conversation)
- [ ] `CHAT-B8` · **No provider configured** — Mode B: a fresh org with no
  provider key → The chat shows **No AI provider connected yet**
  (`chat.providerSetup.title`); an admin sees the **Open AI providers** action
  (`chat.providerSetup.action`); a member sees
  `chat.providerSetup.descriptionMember` — this is a designed state, not a
  defect.
- [ ] `CHAT-B9` · **No notice by default** — On a freshly created org, open
  chat → No **Confidentiality notice** note (`dataNotice.footer.ariaLabel`)
  sits under the composer: the notice is off until an admin turns it on.
- [ ] `CHAT-B10` · **Budget refusal on every send path** — Reach a cap the
  open page does not know about yet (lower the rule in a second tab, or let
  another member spend a shared cap), then try a regenerate, an edit, an arena
  send and a send whose attachment is still processing; **delete the rule
  after** → Each is refused with a toast titled `chat.toast.budgetExceeded`
  and `chat.errorHintBudgetExceeded` below it; a composer send keeps its text,
  no user message or reply lands, and the banner switches to
  `chat.budgetLimitReached` without a reload
- [ ] `CHAT-B11` · **Long project and chat lists** — In an org with 30+
  projects (one holding 20+ chats, expanded) and 40+ unfiled chats, open the
  chats panel in a desktop window, shorten the window, then open the phone
  drawer at 390px → **Projects** (`chat.projectsSection`) never takes more
  than half of the list above **Archived** (`chat.archived.title`), even
  when only a few chats remain, and **Chats** (`chat.chatsSection`) takes
  the rest; both headers stay in view, each list scrolls on its own (a wheel
  or swipe over one never moves the other), a chat dragged onto a folder
  near the edge of the projects list scrolls that list, and a chat dropped
  in the empty room under a short chat list lands under **Chats**, never in
  a folder scrolled out of view

- [ ] `CHAT-B12` · **Audio preflight and mixed files** — In a local org with
  chat available but no usable audio transcription model, select an audio
  file and a text file together → Ordinary chat has no audio setup warning;
  choosing the files opens a dismissible recovery dialog before media bytes
  upload, and only the text file uploads. Repeat with an unavailable
  saved audio-model pin → `chat.transcription.pinnedUnavailable` is shown
  without silently choosing another model. Admin actions open the permitted
  AI providers or Models page; members without that access see admin guidance.
  Dismiss the dialog → The message draft remains usable without a standing
  warning; another refused media attempt can reopen the guidance.
  During a delayed capability read, no missing-setup notice is invented.
- [ ] `CHAT-B13` · **Browser dictation stays independent** — In a browser
  with SpeechRecognition and microphone permission, repeat dictation while
  the org has no server transcription model, then with an unavailable saved
  pin → Browser dictation can start in both cases without a model warning.
  In a browser without SpeechRecognition, activate the microphone with Enter
  → A recovery dialog opens without starting a MediaRecorder recording.
  Escape closes it and returns focus to the microphone.
- [ ] `CHAT-B14` · **Failed turn settles the thinking shell** — Send on a
  credential whose key the provider refuses (a wrong key saved under
  settings.md `SET-F20`), and separately **Stop generating**
  (`chat.stopGenerating`) before the first token → The reply row shows the
  **Couldn't generate a reply** notice (`chat.errorGenerating`) with the
  classified hint, or **Generation stopped** (`chat.generationStopped`); the
  dots and the ticking
  `Thinking · Ns` shell are gone the moment the notice lands and the count
  does not keep running under it; a reload shows the same settled row.

## Accessibility (WCAG 2.1 AA)

- [ ] `CHAT-A1` · **Keyboard send** → Enter sends; Shift+Enter inserts a
  newline; a blocked send announces its reason (toast) instead of silently
  no-opping.
- [ ] `CHAT-A2` · **Landmarks & labels** → The chat region is labelled
  (`chat.aria.chatRegion`), the input (`chat.aria.chatInput`), the transcript
  (`chat.aria.messageHistory`), and the thread-actions menu
  (`chat.aria.threadActions`)
- [ ] `CHAT-A3` · **Generation announced** → The response-status region
  (`chat.generation.regionLabel`) exposes the turn state (queued / streaming /
  waiting) to assistive tech.
- [ ] `CHAT-A4` · **Voice controls labelled** → The mic has an accessible name
  (`chat.dictation.start`) and its level meter is labelled
  (`chat.dictation.level`); **Voice mode** (`chat.voice.voiceModeLabel`)
  exposes `aria-pressed`
- [ ] `CHAT-A5` · **Disclosures keyboardable** → The thought-timeline header
  (CHAT-F16) expands/collapses via keyboard with visible focus; **Scroll to
  bottom** (`chat.scrollToBottom`) is a labelled button.
- [ ] `CHAT-A6` · **Budget banner announced** → The budget banner (CHAT-B6)
  is a `role="alert"` live region in the composer's column, not a strip
  across the pane; its copy is foreground text on the tint (AA contrast in
  light and dark) with the severity carried by the coloured glyph, and
  **View usage** (`chat.budgetViewUsage`), **Request usage credits**
  (`chat.budgetRequestCredits`) and **Dismiss** (`chat.budgetWarningDismiss`)
  are keyboard reachable with visible focus.

## Performance

- [ ] `CHAT-P1` · **TTFT (first token)** → < 3 s warm on a live provider (mode
  B) to the first provider SSE text delta; ≤ ~500 ms in mode A (the mock
  streams a canned reply)
- [ ] `CHAT-P2` · **Attachment upload** → A small PDF uploads and shows its
  chip in < 3 s.
- [ ] `CHAT-P3` · **Thread switch** → Opening a history thread renders its
  messages in < 1 s (warm)
- [ ] `CHAT-P4` · **Long-thread scroll** → A 50+ message thread scrolls
  without visible jank; the timeline/source folds stay responsive.
- [ ] `CHAT-P5` · **Notice holds its place on reload** — With the org's
  notice on, open chat once, then reload at desktop width → The loading
  composer skeleton already carries the notice's row, and neither the
  composer nor the notice moves when the live ones replace the skeleton.
