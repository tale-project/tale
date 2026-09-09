# What the automated suites already own

Manual effort is expensive; spend it where a headless run cannot judge. Read
this before hand-verifying anything, and read the seam notes before running a
suite alongside the automated ones — they drive the same stack.

## Coverage map

One row per case group, carried over from the per-suite coverage tables the
guides used to hold. **Don't** re-verify an automated row by hand: a red there
is a spec failure and belongs in the gate, not in a round.

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

| Suite | Boxes | Status | Owning spec |
|---|---|---|---|
| [settings](../suites/settings.md) | `SET-B11` (REST model discovery) | 🔶 backend | `backend/rest/v1-threads.contract.test.ts`, `backend/rest/v1-threads.test.ts` — org/user scoping, empty catalog, credential-free response, provider forwarded; live provider response stays manual |
| [accessibility](../suites/accessibility.md) | Layer | Status | Where |
| [accessibility](../suites/accessibility.md) | Per-component axe (WCAG 2.1 AA) | ✅ automated | `checkAccessibility()` — `packages/ui/tests/utils/a11y.ts` (axe via `vitest-axe`); ~30+ component `.test.tsx` call it |
| [accessibility](../suites/accessibility.md) | Per-story axe (WCAG 2.1 AA) | ✅ automated | Storybook `@storybook/addon-a11y` + `@storybook/addon-vitest` (`packages/ui/src/storybook/main.ts`); rules `wcag2a/wcag2aa/wcag21aa/best-practice` (`preview.tsx`) |
| [accessibility](../suites/accessibility.md) | Keyboard flows (`A11Y-A3`/`A11Y-A5`) | 🔶 partial | `keyboard.spec.ts` (tab order / shortcuts; **no axe**) |
| [accessibility](../suites/accessibility.md) | Responsive / mobile shell (`A11Y-A14`) | 🔶 partial | `responsive.spec.ts` (viewport layout; **no axe**) |
| [accessibility](../suites/accessibility.md) | Full-page WCAG audits (`A11Y-A1`/`A11Y-A4`/`A11Y-A8`/`A11Y-A13`) | ⛔ manual-only | no axe in e2e — this guide |
| [approvals](../suites/approvals.md) | `APV-F5`–`APV-F6` (ask card) | 🔶 component | — (no e2e; `run-ask-card.test.tsx`: mirror-first submit, blank-answer disable) |
| [approvals](../suites/approvals.md) | `APV-F1`–`APV-F3`, `APV-B1` | 🔶 backend | — (no e2e; `convex/approvals/gate.test.ts`, `policy.test.ts`, `error_codes.test.ts`; no approval-card component test) |
| [approvals](../suites/approvals.md) | `APV-F6`–`APV-F7` (resume) | 🔶 backend | — (no e2e; `convex/automations/human_asks.test.ts`) |
| [approvals](../suites/approvals.md) | `APV-F7b` (ask alerts) | 🔶 backend | — (no e2e; `human_asks.test.ts`: bell fan-out + `getTaskOpsIndicators.askingTaskIds`) |
| [approvals](../suites/approvals.md) | `APV-F8`–`APV-F9` | 🔶 backend | — (no e2e; `convex/tasks/task_reviewer.test.ts`, `review_mutations.test.ts`, `pending_reviews.test.ts`) |
| [approvals](../suites/approvals.md) | `APV-F4`, `APV-F10`–`APV-F12` | ⛔ manual-only | — |
| [approvals](../suites/approvals.md) | `APV-B2`–`APV-B3`, `APV-A1`–`APV-A3`, `APV-P1` | ⛔ manual-only | — |
| [auth](../suites/auth.md) | `AUTH-F2`, `AUTH-F3` | ✅ automated | `auth.spec.ts` |
| [auth](../suites/auth.md) | `AUTH-F4`, `AUTH-F7`, `AUTH-F8`, `AUTH-F9` | ✅ automated | `auth-account.spec.ts` |
| [auth](../suites/auth.md) | `AUTH-F6` | ✅ automated | `onboarding.spec.ts` |
| [auth](../suites/auth.md) | `AUTH-F18` (identity protocol, consent/accessibility, signed continuation) | 🔶 backend + component | `backend/auth/oidc-integration.ts` (real HTTP/Postgres in `backend:integration`), `oauth-authorization.test.tsx`, `resume-oauth.test.ts`, `sentry-normalize.test.ts` (callback-secret redaction); live IdP/passkey/MFA round remains manual |
| [auth](../suites/auth.md) | `AUTH-F14` | ✅ automated | `rbac.spec.ts` |
| [auth](../suites/auth.md) | `AUTH-B5` (char-error path) | ✅ automated | `validation.spec.ts`, `onboarding.spec.ts` |
| [auth](../suites/auth.md) | `AUTH-F15`, `AUTH-F16`, `AUTH-B7` | ✅ automated | `auth.spec.ts` (SSO error / conditional-access / verbatim-fallback via `?error=` params) + component `log-in-sso-error.test.tsx`; backend redirect `authorize_handler.test.ts` |
| [auth](../suites/auth.md) | `AUTH-F1`, `AUTH-F13` | 🔶 partial | `auth.spec.ts` e2e + the `login-idle-notice.test.tsx` unit test |
| [auth](../suites/auth.md) | `AUTH-F5`, `AUTH-F10`–`AUTH-F12`, `AUTH-F17`, `AUTH-B3`, `AUTH-B4` | ⛔ manual-only | — (fresh DB / WebAuthn / IdP / mid-session policy / TOTP / needs 2 orgs) |
| [automations](../suites/automations.md) | `AUTO-F1` (toolbar create), `AUTO-F1b`, `AUTO-F4` (org-level row), `AUTO-F8` (yml lane, Later), `AUTO-F12` (leaf switcher) | 🔶 partial | `automations.spec.ts` (upload → detail switcher → delete) |
| [automations](../suites/automations.md) | Everything else in `AUTO-F1`–`AUTO-F34`, `AUTO-B1`–`AUTO-B6` | ⛔ manual-only | — |
| [automations](../suites/automations.md) | `AUTO-F5`, `AUTO-F13`–`AUTO-F16`, `AUTO-F19` | 🔶 partial | unit: `automations-list.test.tsx`, `automation-detail.test.tsx`, `automation-canvas.test.tsx`, `node-inspector.test.tsx`, `version-list.test.tsx` |
| [automations](../suites/automations.md) | `AUTO-F8`–`AUTO-F11` | 🔶 partial | unit: `upload-automation-dialog.test.tsx` (lanes, zip cap, skill-conflict panel — no end-to-end run) |
| [automations](../suites/automations.md) | `AUTO-F22`–`AUTO-F23`, `AUTO-F26` | 🔶 partial | unit: `effect-list.test.tsx`, `agent-execution-log.test.tsx`, `run-ask-card.test.tsx` |
| [automations](../suites/automations.md) | `AUTO-F27`–`AUTO-F29` | 🔶 partial | unit: `trigger-editor.test.tsx` |
| [automations](../suites/automations.md) | `AUTO-F30` | 🔶 partial | unit: `project-bindings-section.test.tsx` |
| [automations](../suites/automations.md) | `AUTO-F32` | 🔶 partial | unit: `automation-settings-dialog.test.tsx`, `run-step-timeline.test.tsx` |
| [chat](../suites/chat.md) | `CHAT-F30` | ⛔ manual-only | — (`search.spec.ts` has the chat-palette case, but it is fixme-skipped — seeding needs a provider key) |
| [chat](../suites/chat.md) | `CHAT-F3`, `CHAT-F15`, `CHAT-A1`, `CHAT-AT3` | 🔶 component | — (no e2e; `composer.test.tsx` — Enter/Shift+Enter, quote chip prop, pasted-image attach) |
| [chat](../suites/chat.md) | `CHAT-F11`–`CHAT-F12`, `CHAT-F14` | 🔶 component | — (no e2e; `message-toolbar.test.tsx`) |
| [chat](../suites/chat.md) | `CHAT-F13` | 🔶 component | — (no e2e; `message-info-dialog.test.tsx`) |
| [chat](../suites/chat.md) | `CHAT-F16` | 🔶 component | — (no e2e; `thought-timeline.test.tsx`) |
| [chat](../suites/chat.md) | `CHAT-F24` | 🔶 component | — (no e2e; `arena-verdict-bar.test.tsx` — verdict bar only) |
| [chat](../suites/chat.md) | `CHAT-F26` | 🔶 component | — (no e2e; `dictation-button.test.tsx`, `hooks/use-media-recorder-dictation.test.ts`) |
| [chat](../suites/chat.md) | `CHAT-F27`–`CHAT-F29` | 🔶 component | — (no e2e; `thread-list.test.tsx`, `thread-row.test.tsx`) |
| [chat](../suites/chat.md) | `CHAT-F32` | 🔶 component | — (no e2e; `source-cards.test.tsx`) |
| [chat](../suites/chat.md) | `CHAT-F33` | 🔶 component | — (no e2e; `citation-link.test.tsx` in `app/features/shared/markdown/`) |
| [chat](../suites/chat.md) | `CHAT-F34` | 🔶 component | — (no e2e; `step-limit-notice.test.tsx`) |
| [chat](../suites/chat.md) | `CHAT-AT7` | 🔶 component | — (no e2e; `hooks/use-file-transcription-status.test.ts`) |
| [chat](../suites/chat.md) | `CHAT-B6` | 🔶 component | — (no e2e; `budget-banner.test.tsx`) |
| [chat](../suites/chat.md) | `CHAT-F1`–`CHAT-F2`, `CHAT-F4`–`CHAT-F10`, `CHAT-F17`–`CHAT-F23`, `CHAT-F25`, `CHAT-F31`, `CHAT-F35`, `CHAT-AT1`–`CHAT-AT2`, `CHAT-AT4`–`CHAT-AT6`, `CHAT-AT8` | ⛔ manual-only | — |
| [chat](../suites/chat.md) | `CHAT-B1`–`CHAT-B5`, `CHAT-B7`–`CHAT-B8`, `CHAT-A2`–`CHAT-A5`, `CHAT-P1`–`CHAT-P4` | ⛔ manual-only | — |
| [connectors](../suites/connectors.md) | `CONN-F1`, `CONN-F3`–`CONN-F10`, `CONN-F13`, `CONN-F14`, `CONN-B1`, `CONN-B4`, `CONN-B5` | 🔶 component | `app/features/settings/connectors/components/connectors-settings.test.tsx` (rows, add flow, row actions, denial) |
| [connectors](../suites/connectors.md) | `CONN-F1`–`CONN-F3` (empty state, picker, search) | ✅ automated | `settings.spec.ts` ("connectors: empty credentials surface and the add-catalog picker") |
| [connectors](../suites/connectors.md) | `CONN-F7`, `CONN-B1` (required-config gating) | 🔶 component | `app/features/settings/connectors/config-fields.test.tsx` |
| [connectors](../suites/connectors.md) | `CONN-F17` | 🔶 component | `app/features/settings/connectors/components/mcp-endpoint-section.test.tsx` |
| [connectors](../suites/connectors.md) | `CONN-F11`, `CONN-F12`, `CONN-F18`, `CONN-B2`, `CONN-B3`, `CONN-B6` | ⛔ manual-only | — (persistence reloads, live consent round trip, redirects, server refusals) |
| [connectors](../suites/connectors.md) | `CONN-F15`, `CONN-F16` (full round trip) | ⛔ manual-only | — (need a real vendor consent, mode B) |
| [conversations](../suites/conversations.md) | `CONV-G1`–`CONV-G3`, `CONV-F1`–`CONV-F10`, `CONV-B1`–`CONV-B4` | ⛔ manual-only | — (the `email-automation` spec, which automated the gate, redirect, channel filter, and reading pane, was retired in #2857 and has no successor) |
| [conversations](../suites/conversations.md) | `CONV-F11` | 🔶 partial | `backend/domains/conversations/api-sync.integration.ts` owns HTTP/Postgres source imports, attachments, replies, undo, replay, isolation and deletion; `use-inbox-availability.test.ts` owns the API-only gate. Visual two-app flow and keyboard behavior remain manual. |
| [data-residency](../suites/data-residency.md) | Case | Status | Where |
| [data-residency](../suites/data-residency.md) | Panel render / save / probe / clear / access-denied / axe | ✅ automated | `app/features/settings/data-residency/**` (test:ui, 21 tests) |
| [data-residency](../suites/data-residency.md) | Knowledge/embedding admin actions (gating, delegation, credential checks) | ✅ automated | `convex/knowledge/actions.test.ts` |
| [data-residency](../suites/data-residency.md) | Knowledge/embedding file writers (password tri-state, SSRF gate, history, probe fallback) | ✅ automated | `convex/knowledge/file_actions.test.ts` |
| [data-residency](../suites/data-residency.md) | S3 verbs + presign + org-namespace guard (`DATA-B4`) | ✅ automated | `convex/lib/storage/object_store.integration.test.ts`, `blob_ref.test.ts` (MinIO-gated) |
| [data-residency](../suites/data-residency.md) | Document/audio/server-gen blobs land in the bucket | ✅ automated | `convex/lib/storage/object_storage_{documents,producers}.e2e.test.ts` (MinIO-gated) |
| [data-residency](../suites/data-residency.md) | Backfill: happy / idempotent / crash-safe / shared refs / multi-org / dry-run (`DATA-F5`) | ✅ automated | `convex/object_storage/backfill.e2e.test.ts` (13 cases, MinIO-gated) |
| [data-residency](../suites/data-residency.md) | External-DB retrieval incl. chat (`DATA-F6` case (a), the retrieval leg) | ✅ automated | `tests/external-db-retrieval/external-db-retrieval.test.ts` (gated) |
| [data-residency](../suites/data-residency.md) | Documents list renders an `s3:` ref (no `getUrl` crash) — the panel's own uploads | ✅ automated | `convex/documents/transform_batch_s3.test.ts` |
| [data-residency](../suites/data-residency.md) | Embed+store is batched, not all-at-once (`DATA-B5`, embed phase only) | ✅ automated | `convex/rag/lib/indexing_service.store.test.ts` (feeds a pre-built chunk array; does NOT cover the prepare/chunk phase that still scales with size — see `#2752`) |
| [data-residency](../suites/data-residency.md) | `DATA-F4`/`DATA-F6` full-app placement matrix through the real UI | ⛔ manual-only | this plan |
| [data-residency](../suites/data-residency.md) | `DATA-F7` JSON parity on the volume | ⛔ manual-only | this plan |
| [data-residency](../suites/data-residency.md) | `DATA-B5` large-file end-to-end through the real UI | ⛔ manual-only | this plan |
| [governance](../suites/governance.md) | `GOV-F1` | ✅ automated | `navigation.spec.ts` (governance redirect + settings-rail → governance nav) |
| [governance](../suites/governance.md) | `GOV-F2` | ✅ automated | `governance.spec.ts` (voice-output toggle persist/restore; system-prompt edit persist/restore) |
| [governance](../suites/governance.md) | `GOV-F3` (toggle) | 🔶 partial | `governance.spec.ts` (content-safety **enable** toggle persists/restores — filtering manual) |
| [governance](../suites/governance.md) | `GOV-B6` | ✅ automated | `governance.spec.ts` (apiKey scope with no target → `governance.budgets.targetRequired`, no row added) |
| [governance](../suites/governance.md) | `GOV-F4b` | 🔶 partial | `budget-editor.test.tsx` (apiKey scope add + target validation) + `budget_enforcement_apikey.test.ts` (backend enforcement) — no e2e happy-path (needs a seeded key) |
| [governance](../suites/governance.md) | `GOV-F4`, `GOV-F6`–`GOV-F12` | ⛔ manual-only | — |
| [governance](../suites/governance.md) | `GOV-F13`–`GOV-F17` | ⛔ manual-only | — |
| [governance](../suites/governance.md) | `GOV-B1`–`GOV-B5`, `GOV-B7` | ⛔ manual-only | — (B6 is the only automated boundary case) |
| [knowledge](../suites/knowledge.md) | `KNOW-F1` | 🔶 partial | `navigation.spec.ts` (documents route renders to its empty state; the upload flow itself is manual — the `knowledge` spec was retired in #2857) |
| [knowledge](../suites/knowledge.md) | `KNOW-F3`–`KNOW-F5`, `KNOW-F8` | ⛔ manual-only | — (the `knowledge` spec, which automated document/ODT upload and contact CRUD, was retired in #2857) |
| [knowledge](../suites/knowledge.md) | `KNOW-F2`, `KNOW-F6`, `KNOW-F7` | ⛔ manual-only | — (OneDrive sync / website crawl / document preview) |
| [knowledge](../suites/knowledge.md) | `KNOW-F9`–`KNOW-F11` | ⛔ manual-only | — (RAG backend / crawler timing; F11 needs an org without an embedding model) |
| [knowledge](../suites/knowledge.md) | `KNOW-F12` | ⛔ manual-only | — (controlled-document replacement has mutation and component coverage but no browser spec) |
| [metrics](../suites/metrics.md) | `MET-F2` (usage renders) | 🔶 partial | `metrics.spec.ts` (header, filter button, Top Assistants, period section — empty data) |
| [metrics](../suites/metrics.md) | `MET-F4` (feedback empty) | 🔶 partial | `metrics.spec.ts` (header + empty teaching panel only) |
| [metrics](../suites/metrics.md) | `MET-F8` (automations renders) | 🔶 partial | `metrics.spec.ts` (KPI labels, trend chart, table headers — empty data) |
| [metrics](../suites/metrics.md) | `MET-F9` (projects picker) | 🔶 partial | `metrics.spec.ts` (header + picker + no-project empty state) |
| [metrics](../suites/metrics.md) | `MET-F6`, `MET-F7` | 🔶 component | — (no e2e; `chat-health-metrics-page.test.tsx`, `external-turns-metrics-page.test.tsx`) |
| [metrics](../suites/metrics.md) | `MET-B2` | 🔶 component | — (no e2e; `legacy-redirects.test.tsx` route unit tests) |
| [metrics](../suites/metrics.md) | `MET-F1`, `MET-F3`, `MET-F5`, `MET-F10`–`MET-F11` | ⛔ manual-only | — |
| [metrics](../suites/metrics.md) | `MET-B1`, `MET-A1`–`MET-A2`, `MET-P1`–`MET-P2` | ⛔ manual-only | — |
| [navigation](../suites/navigation.md) | `NAV-F1`, `NAV-F2`, `NAV-F3`, `NAV-F7` | ✅ automated | `navigation.spec.ts` |
| [navigation](../suites/navigation.md) | `NAV-F4` | ✅ automated | `search.spec.ts` |
| [navigation](../suites/navigation.md) | `NAV-F9` | ✅ automated | `page-loads.spec.ts` (render-only anchors) |
| [navigation](../suites/navigation.md) | `NAV-F5`, `NAV-F6`, `NAV-F8` | ⛔ manual-only | — |
| [navigation](../suites/navigation.md) | `NAV-F11` | ✅ automated | `navigation.spec.ts` (user-menu Documentation link → `https://tale.dev/docs`) + component `user-button.test.tsx` |
| [navigation](../suites/navigation.md) | `NAV-F10` | ⛔ manual-only | — (no DataTable bulk-action spec exists) |
| [navigation](../suites/navigation.md) | `NAV-F12`–`NAV-F14` | ⛔ manual-only | — (env-gated: version bump / iOS Safari UA / production build with a waiting SW) |
| [navigation](../suites/navigation.md) | `NAV-B1` | ✅ automated | `navigation.spec.ts` (not-found shell) |
| [navigation](../suites/navigation.md) | `NAV-B2` | ✅ automated | `navigation.spec.ts` (styled 404 for an unknown route inside the shell, incl. document title) |
| [navigation](../suites/navigation.md) | `NAV-B3`, `NAV-B4` | ⛔ manual-only | — |
| [navigation](../suites/navigation.md) | `NAV-B5` | ⛔ manual-only | — (env-gated: needs browser network emulation / stopping the local backend) |
| [notifications](../suites/notifications.md) | `NOTIF-F1`–`NOTIF-F8` | ⛔ manual-only | — |
| [notifications](../suites/notifications.md) | `NOTIF-F9`–`NOTIF-F11` | ⛔ manual-only | — (need two accounts in one org; mode A works) |
| [notifications](../suites/notifications.md) | `NOTIF-F12` | ⛔ manual-only | — (env-gated: cron/agent-driven, documentation row) |
| [notifications](../suites/notifications.md) | `NOTIF-F13` | 🔶 backend | — (no e2e; `convex/automations/human_asks.test.ts`: fan-out scope, prefs, fold rewrite, dismissal) |
| [notifications](../suites/notifications.md) | `NOTIF-B1`–`NOTIF-B3` | ⛔ manual-only | — |
| [notifications](../suites/notifications.md) | `NOTIF-A1`–`NOTIF-A3` | ⛔ manual-only | — |
| [performance](../suites/performance.md) | `PERF-P5` (pagination) | 🔶 partial | `projects-depth.spec.ts` (functional, NOT timed) |
| [performance](../suites/performance.md) | `PERF-P1`–`PERF-P4`, `PERF-P6`, `PERF-P7` | ⛔ manual-only | — (no load-timing assertions in e2e; the chat specs that proved P2/P3 functionally retired in #2857) |
| [performance](../suites/performance.md) | `PERF-B4` (provider error) | ⛔ manual-only | — (the `chat-scenarios` spec retired in #2857) |
| [performance](../suites/performance.md) | `PERF-B1`–`PERF-B3`, `PERF-A1`, `PERF-A2` | ⛔ manual-only | — (load characteristics / DOM attributes, not asserted) |
| [projects](../suites/projects.md) | `PROJ-F1`, `PROJ-F9`, `PROJ-F12`, `PROJ-F16`, `PROJ-F19` | ✅ automated | `projects.spec.ts` (create→task in both views→backlog column→delete) |
| [projects](../suites/projects.md) | `PROJ-F2`, `PROJ-F6` | ✅ automated | `projects-depth.spec.ts` (rename + instructions persist) |
| [projects](../suites/projects.md) | `PROJ-F7` | ✅ automated | `projects-depth.spec.ts` (secret create then delete) |
| [projects](../suites/projects.md) | `PROJ-F10`, `PROJ-F12` | ✅ automated | `projects-depth.spec.ts` (status/priority/label persist) |
| [projects](../suites/projects.md) | `PROJ-B2` | ✅ automated | `validation.spec.ts` (delete-confirm phrase gating) |
| [projects](../suites/projects.md) | `PROJ-B1` | 🔶 partial | `project-create-dialog.test.tsx` (unit, not e2e) |
| [projects](../suites/projects.md) | `PROJ-B4` | 🔶 partial | `task-create` unit/component coverage (not e2e) |
| [projects](../suites/projects.md) | `PROJ-F3`, `PROJ-F4`, `PROJ-F5`, `PROJ-F8`, `PROJ-F11`, `PROJ-F13`, `PROJ-F14`, `PROJ-F15` | ⛔ manual-only | — |
| [projects](../suites/projects.md) | `PROJ-F17`, `PROJ-F18`, `PROJ-F20`, `PROJ-F21` | ⛔ manual-only | — |
| [projects](../suites/projects.md) | `PROJ-B3` | ⛔ manual-only | — |
| [responsive](../suites/responsive.md) | `RESP-F1`, `RESP-F2` | ✅ automated | `responsive.spec.ts` (app-shell: rail hidden, tab bar + More sheet) |
| [responsive](../suites/responsive.md) | `RESP-F3` | ✅ automated | `responsive.spec.ts` (floating Save dock: 1 visible Save, dirty→enabled, reload-discard) |
| [responsive](../suites/responsive.md) | `RESP-F4` | 🔶 partial | `responsive.spec.ts` (chat input renders + enabled at mobile; **no send / no attach**) |
| [responsive](../suites/responsive.md) | `RESP-F5` | 🔶 partial | `responsive.spec.ts` (contacts list usable at mobile; **no row/stack assertions**) |
| [responsive](../suites/responsive.md) | `RESP-F6`, `RESP-F7` | ⛔ manual-only | — |
| [responsive](../suites/responsive.md) | `RESP-F9` | ⛔ manual-only | — (needs canvas content, mode B) |
| [responsive](../suites/responsive.md) | `RESP-B1`–`RESP-B3`, `RESP-A1`–`RESP-A3`, `RESP-P1` | ⛔ manual-only | — |
| [settings](../suites/settings.md) | `SET-F3` (account name) | ✅ automated | `settings.spec.ts` |
| [settings](../suites/settings.md) | `SET-F12` (org rename) | ✅ automated | `settings-depth.spec.ts` |
| [settings](../suites/settings.md) | `SET-F18` (teams create/delete) | ✅ automated | `settings-depth.spec.ts` |
| [settings](../suites/settings.md) | `SET-F32` (API key lifecycle) | ✅ automated | `settings-depth.spec.ts` |
| [settings](../suites/settings.md) | `SET-F11` (theme & language) | ✅ automated | `preferences.spec.ts` (Manage-account menu) |
| [settings](../suites/settings.md) | `SET-F6` (preference toggles) | 🔶 partial | `settings-depth.spec.ts` (custom-instructions toggle only; memories + org-default hint manual) |
| [settings](../suites/settings.md) | `SET-F28` (branding) | 🔶 partial | `settings-depth.spec.ts` (accent color only; logo/favicon/reset manual) |
| [settings](../suites/settings.md) | `SET-F20`–`SET-F21` (providers page + add) | 🔶 partial | `settings.spec.ts` (empty state + add-catalog picker; no credential is actually created) |
| [settings](../suites/settings.md) | `SET-F24` (connectors page) | 🔶 partial | `settings.spec.ts` (empty state + add-catalog picker) |
| [settings](../suites/settings.md) | `SET-F14`–`SET-F15` (members) | 🔶 partial | `rbac.spec.ts` (a member cannot see the add-member control; the add flows themselves are manual) |
| [settings](../suites/settings.md) | `SET-F1` (rail) | 🔶 component | — (no e2e; `settings-rail.test.tsx`) |
| [settings](../suites/settings.md) | `SET-F9` (notification prefs) | 🔶 component | — (no e2e; `notification-preferences-settings.test.tsx`) |
| [settings](../suites/settings.md) | `SET-F16`–`SET-F17` (member dialogs) | 🔶 component | — (no e2e; `member-add-dialog.test.tsx`, `member-row-actions.test.tsx`, `member-table.test.tsx`) |
| [settings](../suites/settings.md) | `SET-F33` (MCP endpoint) | 🔶 component | — (no e2e; `mcp-endpoint-section.test.tsx`) |
| [settings](../suites/settings.md) | `SET-F35` (Enterprise SSO) | 🔶 component | — (no e2e; `enterprise-sso-form.test.tsx`) |
| [settings](../suites/settings.md) | `SET-F36` (data residency) | 🔶 component | — (no e2e; `data-residency-settings.test.tsx`) |
| [settings](../suites/settings.md) | `SET-F2`, `SET-F4`–`SET-F5`, `SET-F7`–`SET-F8`, `SET-F13`, `SET-F19`, `SET-F22`–`SET-F23`, `SET-F25`–`SET-F27`, `SET-F29`–`SET-F31`, `SET-F34` | ⛔ manual-only | — |
| [settings](../suites/settings.md) | `SET-B1`–`SET-B10`, `SET-A1`–`SET-A5`, `SET-P1`–`SET-P3` | ⛔ manual-only | — |
| [skills](../suites/skills.md) | `SKILL-B1`, `SKILL-B3` (server side) | 🔶 partial | — (no e2e; `convex/skills/bundle_zip.test.ts` covers the backend) |
| [skills](../suites/skills.md) | `SKILL-F1`–`SKILL-F12`, `SKILL-B2`, `SKILL-A1`–`SKILL-A2`, `SKILL-P1` | ⛔ manual-only | — |
| [tasks](../suites/tasks.md) | `TASK-F2`, `TASK-F6` (create, both views) | ✅ automated | `projects.spec.ts` (create task, board↔list visibility, create into Backlog, promote via status picker) |
| [tasks](../suites/tasks.md) | `TASK-F7` (status/priority/label) | ✅ automated | `projects-depth.spec.ts` (live-edit persists across board and list) |
| [tasks](../suites/tasks.md) | `TASK-F11` (assign) | 🔶 partial | `return-loops.spec.ts` (assigning notifies + calls back the assignee; picker sections themselves manual) |
| [tasks](../suites/tasks.md) | `TASK-F3`, `TASK-F5` | 🔶 component | — (no e2e; `kanban-board.test.tsx`, `tasks-list.test.tsx`) |
| [tasks](../suites/tasks.md) | `TASK-F8` | 🔶 component | — (no e2e; `task-comments.test.tsx`, `mention-text.test.tsx`) |
| [tasks](../suites/tasks.md) | `TASK-F9` | 🔶 component | — (no e2e; `task-attachments.test.tsx`, `task-input-files.test.tsx`) |
| [tasks](../suites/tasks.md) | `TASK-F12` | 🔶 component | — (no e2e; `task-agent-run-entry.test.tsx`, `task-run-failure-banner.test.tsx`, `task-subject-panel.test.tsx`) |
| [tasks](../suites/tasks.md) | `TASK-F14` | 🔶 component | — (no e2e; `task-outcome-files.test.tsx`; backend `convex/tasks/task_agent_outputs.test.ts`) |
| [tasks](../suites/tasks.md) | `TASK-F16` | 🔶 component | — (no e2e; `task-timeline.test.tsx`, `task-archive-dialog.test.tsx`) |
| [tasks](../suites/tasks.md) | `TASK-B1` | 🔶 unit | — (no e2e; `app/features/tasks/lib/dependencies.test.ts` + `convex/tasks/dependencies.test.ts`; the toast manual) |
| [tasks](../suites/tasks.md) | `TASK-F1`, `TASK-F4`, `TASK-F10`, `TASK-F13`, `TASK-F15` | ⛔ manual-only | — (no e2e drives DnD, the run/transcript dialogs, or the review decision) |
| [tasks](../suites/tasks.md) | `TASK-B2`–`TASK-B4`, `TASK-A1`–`TASK-A3`, `TASK-P1`–`TASK-P2` | ⛔ manual-only | — |
| [video-links](../suites/video-links.md) | `VID-F1`, `VID-F4` | ⛔ manual-only | — |
| [video-links](../suites/video-links.md) | `VID-F2`, `VID-F3` | 🔶 partial | components only: `convex/video_links/captions_parser.test.ts`, `url_safety.test.ts`, `synthetic_file_metadata.test.ts`, `donor_reuse.test.ts`; no e2e job run |
| [video-links](../suites/video-links.md) | `VID-F5` | 🔶 partial | `lib/shared/video-url.test.ts` (playlist detection); the ConvexError surface is manual |
| [video-links](../suites/video-links.md) | `VID-F6`, `VID-F7` | 🔶 partial | `backend/core/video_links/ytdlp_live.test.ts` — gated `YOUTUBE_LIVE_TEST=1` (the CI Unit job in `.github/workflows/checks.yml` runs it from a datacenter IP) |
| [video-links](../suites/video-links.md) | `VID-B1`–`VID-B3` | 🔶 partial | `convex/video_links/ytdlp.test.ts` (stderr classifier, env-flag builders, log sanitizer); the live job-row/log behaviour is manual |

## Seams

- **The Playwright suite drives the same origin a round does.** Never run
  `bun run test:e2e` beside a round: it signs in, creates and deletes data, and
  leaves the stack in its end state.
- **The vitest lanes (`test`, `test:ui`, `test:browser`) boot and tear down
  their own stack**, so they are safe beside a round.

## Moving a box here

When a spec takes a box over end to end, **delete the box and add its row here
in the same commit**, naming the spec. A box that survives its automation is
manual effort spent twice; `bun run lint:manual` rejects a box ID here that no
suite defines.
