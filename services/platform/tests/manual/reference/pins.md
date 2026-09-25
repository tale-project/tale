# Why a box says that

Each row below is an expectation a suite carries **because something once went
wrong**. The box itself states only the check, so it stays readable; the reason
lives here.

Read this **before you reword, merge or delete a box** — an oddly specific
expectation is usually specific on purpose. Read it too when a box fails and you
want to know what class of defect it was written to catch.

Rows marked `docs` are corrections to this guide rather than to the product: the
box used to ask for something unreachable or wrong, and a round proved it. They
stay so nobody re-introduces the old wording.

**Adding a row:** when a round sharpens a box, add the row here in the same
change as the box edit. Key it by box ID, state the mechanism (not the symptom),
and name the test that now holds it. Never key a row by round — the journal in
[`../runs`](../runs) records rounds, this register records product knowledge.

**This register starts empty on purpose.** It was created on 2026-09-08 with the
shared manual-test shape; until then a box's reason lived inside its own wording,
which is why several boxes read as long as they do. Move a reason here the first
time you are tempted to shorten one.

| Box | What it pins |
|---|---|
| `AUTH-F18` | Better Auth's browser fetch plugin already follows successful consent/continuation responses. A second navigation can race the callback's one-use state and code; `oauth-authorization.test.tsx` pins single redirect ownership, StrictMode continuation and both consent actions. |
| `SET-A7` | The device label and revoked badge competed for one non-wrapping flex row, so a long label shrank the badge into an ellipsis. The group wraps and the status keeps its intrinsic width. This box holds visible EN/DE/FR status text at desktop and narrow widths; `webdav-settings.test.tsx` separately holds active/null and revoked action states. |

| `NAV-F1` | The main rail is labelled Chat and uses `navigation.chat`; New chat is a separate action. A rail click always commits the section's default entry, whatever the user did there before — `sidebar-nav.test.tsx` holds that rule, this box judges the labels, order and active styling. |
| `NAV-F9` | The API page now links developer prose and raw OpenAPI separately. `app/routes/docs.test.tsx` holds link destinations and accessibility; the manual box judges readable and keyboard-reachable links at phone width. |
| `NAV-F11` | The public docs moved to a separate origin. `app/components/user-button.test.tsx` pins the shared canonical constant and safe new-tab attributes; the box no longer expects the old marketing-site subpath. |
| `KNOW-F16` | The hub folder listing decorated only `active` sync configs, so a config in `error` lost its "(synced)" label and read as a plain folder — a dead grant froze the mirror with nothing on screen and nobody told (2026-09-15). The listing now decorates errored configs too, the Source cell carries the health badge, and the owner gets one bell + email per failure episode; `sync-health.test.ts` and `service.failure-notify.test.ts` hold the episode rule, the itest lane `onedrive dead grant…` holds it end to end. The badge must also disappear WITHOUT a reload: the engine now emits `folder`/`document` hints, which it never did before. |
| `KNOW-F19` | The Source cell spelled its source out, so "OneDrive (synchronisiert)" wrapped onto two lines at the column's minimum width and ran into RAG status; Google Drive alone showed a bare mark that never said whether it synced, and the preview sidebar kept its own three-provider map that printed `google_drive` for the rest (2026-09-15). The cell is now the vendor mark plus a synced / not-synced / failure glyph, from one map the preview reads too, with the words on hover, on focus and as the accessible name; `use-document-source.test.tsx` and `use-documents-table-config.test.tsx` hold the names and glyphs, while the fit, the preview sidebar and the dark theme stay manual. |
| `RESP-F2` | The mobile More sheet is a `Sheet` opened from state — no Radix trigger — and `Sheet` never ran `useRestoreFocus`, so Escape dropped the document on `<body>`. The primitive now restores the opener (`sheet.test.tsx`); this box judges the More tab regaining focus. |
| `TASK-A2` / `PROJ-A2` | The task detail is a `ResponsiveDialog` with no trigger; neither its dialog nor its drawer branch passed `onCloseAutoFocus`, so Escape left focus on `<body>`. The primitive now captures the opener (`responsive-dialog.test.tsx`); the boxes judge the card regaining focus. |
| `A11Y-A12` | `FilterPanel` renders through `Popover`, whose Radix content is `role="dialog"` with no name; the panel now labels it by its visible heading (`filter-panel.test.tsx`). |
| `A11Y-A3` / `MET-F3` | `DataTable`'s `onRowClick` is a bare `onClick` on a `<tr>` — pointer-only. The metrics drill-down tables (Top models/agents/voice models, feedback, automations) carry a named "Filter by {name}" button in the lead cell (`usage-metrics-page.test.tsx`); the rule is the data-table guide's. |
| `AUTO-A3` | Same mechanism: the automations list name is a real `<Link>` to the editor (`automations-list.test.tsx`); the row click stays a pointer convenience. |
| `PERF-B5` | Over HTTP/1.1 a browser opens at most six connections to one host, shared by every tab, and each dashboard tab held its `/events` stream (plus a chat thread's stream) for life. With five tabs open the sixth rendered but some reads hung forever; with six, the seventh could not load its page. Streams now close after 5 s hidden and reopen from their cursor (`while-visible.test.ts`, `use-backend-hints.test.tsx`, `thread-stream.test.tsx`; the itest lane `authorized outbox → SSE` holds the `?lastEventId=` resume). Production behind Caddy speaks HTTP/2 and never hit the limit, so this box runs on the dev server. |
| `A11Y-A8` | Table header text sat `--muted-foreground` on the `--muted` fill: 4.40:1, under AA for 14px text. `TableHead` reads `--table-header-foreground` (zinc-600, 7.03:1) — `table.test.tsx`, and the design audit's "on `--muted`" row. |
| `RESP-B3` / `RESP-A2` | The account menu name was a block `<p>` around an inline-block box with no truncation, so an unbreakable 87-character name ran past the `w-64` menu with `text-overflow: clip`. Both lines truncate (`user-button.test.tsx`). |
| `GOV-F16` | The app door answers `{key, config}` — the on/off flag is `config.enabled`; the PII switch and all three overview cards read a policy-level `enabled` left from the previous row shape, so an enabled policy rendered Off after reload. One reader, `policyEnabled` (`pii-config.test.tsx`, `guardrails-overview.test.tsx`). |
| `DATA-F10` | The reveal switch is local state, not a form field; the header Discard reset the fields and left it on. `useFormEditor` now takes `onReset` (`use-form-editor.test.tsx`, `data-residency-settings.test.tsx`). |
| `SET-F2` | `settings.menu.<key>.description` is built from the entry key at runtime, which the catalog guard cannot enumerate; `skills` had no description in any locale. `use-settings-menu-groups.test.tsx` resolves every entry. |
| `SKILL-F4` | The door keeps a stored icon when the field is omitted and clears it on `null`; "No icon" dropped the field, so the rocket survived every save. The editor sends `icon: null` (`skill-detail-pane.test.tsx`, `library.test.ts`). |
| `CONN-F15` | The "no OAuth app" explainer assumed every app is registered in the organization's OAuth apps card; Slack's is deployment-only. The catalog answers `orgConfigurable` and the copy names the operator (`oauth-app-missing.test.ts`). |
| `KNOW-B5` | `AppError.message` is the serialized payload by design; the folder-delete toast printed it. Both surfaces read `data.message` and name a retained record in words (`document-row-actions.test.tsx`, `project-files-tab.test.tsx`). |
| `VID-F5` | The extractor skips a playlist URL silently by design (no chip may spawn a job for it); the paste now toasts the existing "playlists aren't supported" copy once (`video-url.test.ts` `findPlaylistUrls`). |
| `A11Y-A2` | Under the injected `<base href>` a skip link whose target is missing resolved `#main-content` to the site root and landed anonymous readers of `/docs` on sign-in. The shared `SkipLink` sets the hash on the current document and `/docs` and `/2fa-enroll` carry the target (`skip-link.test.tsx`, `docs.test.tsx`). |
| `SET-F29` | The image write never recorded its reference; the form staged it and only the header Save wrote it, so a reload before Save showed the default. `saveBrandingImage` / `deleteBrandingImage` write the config field (`branding/service.test.ts`), and uploads no longer dirty the form (`branding-form.test.tsx`). |
| `APV-F1` | The stepper asked the approval gate before it resolved `node.input`, so the automation card carried no parameters (the user-initiated door always did). The gate now receives the resolved input (`stepper.approval-input.test.ts`); a loop body's `item`/`index` cannot be resolved ahead of the loop and that card still carries none. |
| `CONV-F13` | Only the email lane completed the drafted reply on send; a native API reply queued the message and left the draft pending, so it was re-offered on every reload. One `completePendingDraftInTx` for both lanes (`draft.test.ts`). |
| `CONV-F8` | "Improve with AI" was a client-side stub answering "offline while the platform AI backend is rewritten" since the Postgres cutover. It is now one bounded direct model call on the title lane's model pick, booked under `inbox-improve` (`improve.test.ts`, `routes.test.ts`). |
| `CHAT-F30` | Edit and regenerate land on a HIDDEN sibling thread; search scanned only unhidden threads, so text typed after an edit was unsearchable. The scan covers the root's live lineage (`threads.test.ts`). |
| `KNOW-F22` | The indexing job's catch wrote the failure on the file only; the corpus row stayed `processing`, and the RAG watchdog read that as a live chain and "revived" the file to `running` with no job behind it. Every classified failure now lands on both rows (`service.provider-refusal.test.ts`, `indexing.test.ts`); a width mismatch ends the job at once instead of five retries reporting "the platform's side"; a provider's batch cap is learned from its refusal (`embedding.test.ts`). |
| `DATA-F11` | Saving the embedding settings re-queued only `embedding_not_configured`; a wrong endpoint or width fixed by the same save re-queued nothing, and the stalled row offered no Retry. The three embedding codes re-queue (`requeue-embedding.test.ts`). |
