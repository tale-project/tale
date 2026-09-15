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

| `NAV-F1` | The main rail is labelled Chat and uses `navigation.chat`; New chat is a separate action. Section memory changes re-entry targets, so the default-entry check starts with fresh task-owned browser storage. `nav-memory.test.ts` holds the remembered-target rules. |
| `NAV-F9` | The API page now links developer prose and raw OpenAPI separately. `app/routes/docs.test.tsx` holds link destinations and accessibility; the manual box judges readable and keyboard-reachable links at phone width. |
| `NAV-F11` | The public docs moved to a separate origin. `app/components/user-button.test.tsx` pins the shared canonical constant and safe new-tab attributes; the box no longer expects the old marketing-site subpath. |
| `KNOW-F16` | The hub folder listing decorated only `active` sync configs, so a config in `error` lost its "(synced)" label and read as a plain folder — a dead grant froze the mirror with nothing on screen and nobody told (2026-09-15). The listing now decorates errored configs too, the Source cell carries the health badge, and the owner gets one bell + email per failure episode; `sync-health.test.ts` and `service.failure-notify.test.ts` hold the episode rule, the itest lane `onedrive dead grant…` holds it end to end. The badge must also disappear WITHOUT a reload: the engine now emits `folder`/`document` hints, which it never did before. |
| `KNOW-F19` | The Source cell spelled its source out, so "OneDrive (synchronisiert)" wrapped onto two lines at the column's minimum width and ran into RAG status, while Google Drive alone showed a bare mark that never said whether it synced (2026-09-15). The cell is now the vendor mark plus a synced / not-synced glyph, with the words on hover and as the accessible name; `use-documents-table-config.test.tsx` holds the names and glyphs, the fit and the dark theme stay manual. |
