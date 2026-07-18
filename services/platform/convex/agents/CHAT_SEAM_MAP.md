# Chat Seam Map & PR seam-checklist

> Status: REFERENCE. This maps the **seams** of the chat feature — the boundaries
> where state crosses from one subsystem to another — plus a **PR seam-checklist**
> a reviewer runs against any chat change. It fixes no bug and changes no
> behaviour; it captures where the bugs have historically lived so the next change
> can be reasoned about before it merges. **Keep it truthful:** a change that moves
> a chat seam updates the matching entry here in the same PR (root `AGENTS.md`:
> "Instructions are docs too").
>
> Anchors are `path:symbol` relative to `services/platform/` (the common root of
> the backend `convex/` and the SPA `app/`). Symbols are stable; line numbers are
> not, so none are cited — grep the symbol.

## Why this doc exists

The chat subsystems — streaming, routing, branching, RAG, org-scoping — are each
individually well-tested. The bugs almost never live _inside_ one of them. They
live on the **seams**: a value carried across a boundary under a condition the
author's machine never reproduces. Those conditions recur, so the same _class_ of
seam bug keeps shipping. This map names the seams; the checklist forces the
conditions.

### The turn spine (the path every anchor hangs off)

A chat turn flows: composer `app/features/chat/components/chat-input.tsx:ChatInput`
→ send hook `app/features/chat/hooks/use-send-message.ts:useSendMessage` (paints
the optimistic bubble via `pendingMessage`) → mutation wrapper
`app/features/chat/hooks/mutations.ts:useUnifiedChatWithAgent` → entry mutation
`convex/agents/chat_turn.ts:chatWithAgentTurn` (fast V8 DB work + the access
gates, then `persistentStreaming.createStream`, mark generating, and schedule)
→ scheduled node action `convex/agents/chat_turn_generate.ts:runChatTurnGeneration`
(external-agent lock → auto-route → agent config + guardrails + governance load →
model RBAC / input guardrails → persist) → `convex/lib/agent_chat/internal_actions.ts:runGenerationCore`
→ `convex/lib/agent_response/generate_response.ts:generateAgentResponse` (RAG
retrieval + `agent.streamText` tool loop + persistent streaming + the
`shouldRetryGeneration` continue loop) → per-message telemetry in
`convex/streaming/schema.ts:messageMetadataTable` → client render via `useUIMessages`
(`app/features/chat/hooks/use-message-processing.ts:useMessageProcessing`).
Message storage is the `@convex-dev/agent` component; live text is
`@convex-dev/persistent-text-streaming` (both registered in
`convex/convex.config.ts`; streaming wired in `convex/streaming/helpers.ts:persistentStreaming`).

> "Chat" (threads / agents / streaming) is a **different** subsystem from
> "conversations" (email / contacts). The only bridge is tool-level. Don't
> conflate them.

### The 5 blind spots (why these bugs never reproduce locally)

| #   | Blind spot                                          | Why local dev never shows it                                                                                                                                                                         |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Zero-latency localhost**                          | Flicker / paint / timer / optimistic-swap bugs need real client↔server latency + clock skew. Invisible under `bun dev`.                                                                              |
| 2   | **The single-org session**                          | Cross-org coherence needs a user in **2+ orgs** who switches org mid-session with a thread open. Non-members stay blocked, so security scanners stay silent — it is a _correctness_ bug in the seam. |
| 3   | **Provider output variance**                        | Real models emit shapes the local mock never does: a missing / unlabelled `finish_reason`, or reasoning-only / tool-only turns with no content text.                                                 |
| 4   | **The shipped happy path hides the general bug**    | Client-only caps are never exceeded through the UI; every shipped agent bundles the same tools, so a dead-end only fires on a custom / minimal / BYO agent.                                          |
| 5   | **Adversarial code-reading, not usage, finds them** | Most were found by contrasting a handler against its correctly-gated sibling — not by clicking through the app.                                                                                      |

---

## Seam Map

Each seam: **what state crosses · what enforces the invariant · the invariant ·
what it has broken · the hidden condition.**

### Seam 1 — Active-org context → every thread query

- **State that crosses:** the org the user is _acting in_ (`args.organizationId`)
  vs. the org that _owns_ the thread (`threadMetadata.organizationId`).
- **Enforced by:** `convex/lib/rls/auth/can_access_thread.ts:canAccessThread`
  (+ `assertThreadAccess`, `canAccessThreadOrSubThread`). On the hot **owner** path
  `convex/agents/chat_turn.ts:chatWithAgentTurn` **hand-rolls** the same check inline
  (`meta.organizationId !== args.organizationId` → throw; `meta.userId !== authUser.userId`
  rejected unless `kind === 'automation_discussion'`, which routes through
  `assertThreadAccess`) rather than calling `canAccessThread`. The shared guard
  `convex/lib/rls/organization/assert_active_org.ts:isActiveOrg`/`assertActiveOrg`
  was _extracted from_ this pattern for **other** by-id surfaces (projects / tasks /
  docs) — the thread path does org-equality inline and does **not** consume it.
- **Invariant:** a thread is readable/writable only when its org **equals** the
  acting org **and** the actor is a member of that org.
- **Has broken:** #2170 (PR) scope chat thread reads to the active org · #2279 (PR)
  enforce active-org coherence on by-id reads and writes · #2277 (PR) reset cross-org
  entity subpath on org switch. The pattern recurred across ~22 by-id reads / ~12
  domains.
- **Hidden condition (blind spot #2):** a user in 2+ orgs opens a thread in org A,
  switches to org B mid-session, and the stale by-id read serves A's data into B.
  Because non-members are still blocked, no scanner flags it.

### Seam 2 — Client agent pick ↔ stored thread agent (external-agent lock)

- **State that crosses:** the agent slug the client currently has selected vs. the
  agent already locked onto the thread.
- **Enforced by:** `convex/agents/chat_turn_generate.ts:runChatTurnGeneration`
  **step 0** — `chat_turn.ts` captures `priorAgentSlug` _before_ it optimistically
  patches `agentSlug`; if `priorAgentSlug !== agentSlug` and the prior resolves to
  `primaryBehavior === 'external-agent'`, the **stored agent wins**, `setThreadAgentSlug`
  corrects the optimistic patch, and auto-route (step 1) is skipped. Client mirror:
  `app/features/chat/hooks/use-thread-agent-lock.ts:useThreadAgentLock` (its own
  doc-comment notes the backend enforces the lock independently).
- **Invariant:** a locked external-agent thread keeps its agent over a stale client
  slug. (A prior agent that no longer resolves — uninstalled/renamed — falls through
  to the client selection.)
- **Has broken:** #2417 (PR) stabilize external-agent chat threads.
- **Hidden condition (blind spot #4):** switching agents while another thread is
  open, or sending mid-turn, so the client slug and the thread's locked agent
  disagree. Only reproducible with a real **external** agent installed — the bundled
  agents never trip it.

### Seam 3 — Branch state → file / canvas listing

- **State that crosses:** a branched thread's fork point vs. the set of files it may
  see from its ancestor chain.
- **Enforced by:** `convex/threads/get_branch_ancestor_thread_ids.ts:getBranchAncestorThreadIds`
  (walks tip→root, keeping the tightest `Math.min` cut per hop) feeding
  `convex/thread_files/queries.ts:listThreadFilesForUser` (unions each ancestor hop's
  `threadFiles` + delegate sub-threads, cutting each hop at its `filesBefore`). Cut
  key is the schema field `convex/threads/branch_schema.ts` `forkOrderCreatedAt`.
  Client branch state: `app/features/chat/context/branch-context.tsx`.
- **Invariant:** a branch sees ancestor files only **up to the fork point**; the tip
  itself is uncut.
- **Has broken:** a branched chat dropped earlier files because the listing unioned
  only the active branch **tip**, not the ancestor chain — fixed by routing through
  `getBranchAncestorThreadIds`.
- **Hidden condition (blind spot #4):** a **branched** thread that has ancestor
  files. A single linear thread never exercises the ancestor-union path.

### Seam 4 — Optimistic bubble → persisted swap

- **State that crosses:** the client-only optimistic user bubble / assistant
  "Thinking" shell vs. the persisted rows streamed back.
- **Enforced by:** `app/features/chat/context/chat-layout-context.tsx:PendingMessage`
  / `pendingMessage`, reconciled in
  `app/features/chat/hooks/use-pending-messages.ts:usePendingMessages`: it keeps the
  optimistic user bubble until the persisted user row lands (baseline
  `lastMessageKey` changes) then drops it, and swaps the assistant shell into the
  real row with a **stable key** via `promoteAssistantWithShellIdentity` to avoid a
  remount/flash.
- **Invariant:** the optimistic bubble matches the persisted row on arrival, and the
  swap causes no remount, flash, or duplicate.
- **Has broken:** #2658 (Issue, closed) archived-chat flicker between active/archived
  layout · #2716 (Issue, **open**) composer pickers paint blank on a thread route ·
  #2510 (PR) keep the thinking indicator stable across send handoffs · #2511 (PR)
  clock-safe chat UI (timer rewind + message-position error).
- **Hidden condition (blind spot #1):** real latency + clock skew between the
  optimistic paint and the persisted swap. Zero-latency localhost never separates the
  two frames.

### Seam 5 — Provider turn-shape → server retry / stop-conditions → render

- **State that crosses:** the model's `finishReason` + step shape (which may be
  missing, unlabelled, or text-less) into the continue-vs-terminal decision.
- **Enforced by (server-side only):**
  `convex/lib/agent_response/retry_policy.ts:shouldRetryGeneration` — human-input
  gate → terminal; `'tool-calls'` → step-cap continue (`MAX_STEP_CAP_CONTINUES`);
  `NON_RETRYABLE_FINISH_REASONS` → terminal, with the DeepSeek `'stop'`-empty-after-tools
  exception via `needsToolResultRetry`; and `UNLABELLED_FINISH_REASONS`
  (`{'other','unknown'}` + `undefined`) **with substantive text** → accepted as
  complete. Loop halt: `convex/lib/agent_response/stop_conditions.ts:hasValidToolCall`
  (`stopWhen: hasValidToolCall('request_human_input')`). Consumer: the continue loop
  in `convex/lib/agent_response/generate_response.ts`.
- **Invariant:** every real turn shape resolves cleanly — an unlabelled finish with
  real text is **not** re-run (re-running a finished answer regenerates it from
  scratch: duplicate content, doubled tokens, spurious ⚠ retry marker).
- **Note:** there is **no client-side `finish_reason` state machine** — the client
  renders whatever `useUIMessages` yields; text-less (reasoning-only / tool-only)
  turns are a render/merge concern in `use-message-processing.ts` /
  `use-pending-messages.ts`, not a stop-reason interpretation.
- **Has broken:** #2771 (PR) accept unlabelled finish reasons with substantive text ·
  #2398 (PR) stop stranding turns on failed human-input gate calls · #2767 (Issue,
  **open**) pausing a human-input turn with no content text triggers a spurious
  model-fallback banner.
- **Hidden condition (blind spot #3):** a real provider emitting an unlabelled
  finish, or a reasoning-only / tool-only turn. The local mock always returns a
  labelled finish with body text.

### Seam 6 — @-mention pick → send-time re-resolution

- **State that crosses:** a document / person referenced at _compose_ time vs. its
  authorization at _send_ time.
- **Enforced by:** `convex/agents/resolve_referenced_files.ts:resolveReferencedFiles`
  (+ the folder twin `convex/agents/resolve_referenced_folders.ts:resolveReferencedFolders`),
  called from `chat_turn.ts:chatWithAgentTurn`, capped at `MAX_KB_REFERENCES`. It
  re-checks: same org, `isActiveDocument`, scope (project-scoped → `threadProjectId`
  match + `canReadDocument`; else `hasKnowledgeHubDocumentAccess` against the user's
  team set), blob-backed (`fileId`), and RAG-indexed (`ragStatus === 'completed'`).
  Any failure throws one opaque `KB_REF_INVALID` (never reveals whether an
  inaccessible doc exists).
- **Invariant:** a referenced doc/person is **re-authorized at send**, not trusted
  from the pick.
- **Has broken:** `KB_REF_INVALID` / dead mentions.
- **Hidden condition (blind spot #4):** the referent is deleted, de-indexed, or moved
  out of the user's teams **between pick and send**. The happy path picks and sends
  within one authorized session.

### Seam 7 — Auto-route decision → UI signal (two distinct stores)

- **State that crosses:** the router's chosen agent, in two forms — a reusable
  **server cache** and a **live UI signal**. These are not the same store.
- **Enforced by:**
  - Server cache: table `convex/agents/schema.ts:autoRouteCacheTable`, read in
    `convex/agents/auto_route.ts:resolveAutoRoute`, keyed `org + candidatesHash +
messageKey` (classifier reuse — _not_ a UI read).
  - UI signal: `threadMetadata.liveRoute`, set by
    `convex/threads/internal_mutations.ts:setLiveRoute` (broadcast from
    `runChatTurnGeneration` step 1) and surfaced by
    `convex/threads/queries.ts:getThreadMeta`, gated on `isGenerating` so an idle
    thread never carries a stale route.
- **Invariant:** classifier reuse is cache-keyed per org; the UI's live route
  reflects the actual routed agent for _this_ turn and clears when idle.
- **Has broken:** #2716 (Issue, **open**) composer agent/model pickers paint blank on
  a thread route.
- **Hidden condition (blind spot #1 paint + #3):** the picker mounts on a thread
  route before the live route/metadata resolves (latency), or the route depends on a
  real classifier's output for a real message.

### Seam 8 — projectId binding

- **State that crosses:** the projectId supplied on a send vs. the projectId already
  bound to the thread, and both vs. the acting org.
- **Enforced by:** `convex/agents/start_chat.ts:startChat` binds projectId once (or
  throws `PROJECT_MISMATCH` on a conflicting rebind). `chat_turn.ts:chatWithAgentTurn`
  gates via `assertProjectAccessForChat` (→ `PROJECT_NOT_FOUND` / `PROJECT_ORG_MISMATCH`
  / `PROJECT_FORBIDDEN`), re-checks thread-org, and throws a synchronous
  `PROJECT_MISMATCH` when `args.projectId !== meta.projectId`. The @-mention gate uses
  `threadProjectId = meta.projectId ?? args.projectId`.
- **Invariant:** a thread's projectId is bound once; a project-scoped @-ref is
  pinnable only from the matching-project thread; org and project can't cross.
- **Has broken:** — (no single headline PR; a guarded latent seam — kept as
  defense-in-depth across `startChat` and `chatWithAgentTurn`).
- **Hidden condition (blind spot #2):** an org/project mismatch — a project from one
  org referenced from a thread acting in another. Needs the multi-org / multi-project
  session to surface.

### Seam 9 — model → governance RBAC

- **State that crosses:** the model chosen for the turn vs. the actor's role /
  governance access.
- **Enforced by:** `convex/governance/internal_queries.ts:resolveGenerationGovernance`
  (one round-trip: role / teamIds / defaultModel / accessibleModelIds / explicitAccess)
  - `convex/governance/model_access_enforcement.ts:checkModelAccess`. Applied in
    `runChatTurnGeneration` steps 4 (governance default), 5 (implicit RBAC filter),
    5b (external dynamic resolution), and 7 (explicit-modelId check, whose denial writes
    an audited `model_access.denied` via `createAuditLog`). External BYO / env-managed
    agents bypass platform governance via `skipsPlatformModelGovernance`.
- **Invariant:** a turn's model is within the actor's access, or is denied with an
  audited system notice (not a silent client throw).
- **Has broken:** #2023 (PR) read governance policy from server state instead of
  mirroring in `useState`.
- **Hidden condition (blind spot #4):** a **custom / minimal / BYO** agent — the
  `skipsPlatformModelGovernance` path and the explicit-modelId denial never fire for
  the uniformly-bundled shipped agents.

### Seam 10 — In-flight supersede vs. new send

- **State that crosses:** a still-streaming turn vs. a newly-sent message on the same
  thread.
- **Enforced by (two paths):**
  - Supersede (Track-B chat): `chat_turn.ts:chatWithAgentTurn` calls
    `convex/threads/cancel_generation.ts:cancelGeneration` before starting the new
    turn (cancel-then-restart).
  - Queue (external-agent): `convex/threads/message_queue.ts` (`chatMessageQueue`,
    `drainQueuedMessages`) enqueues and drains at the turn boundary.
  - The running action notices via
    `convex/lib/agent_response/abort_watcher.ts:startAbortWatcher`
    (`ABORT_POLL_INTERVAL_MS`).
- **Invariant:** a send during an active turn cleanly cancels-then-restarts (chat) or
  enqueues+drains (external); the thinking indicator stays stable across the handoff.
- **Has broken:** #2510 (PR) keep the thinking indicator stable across send handoffs.
- **Hidden condition (blind spot #1):** the send lands _while_ the prior turn is
  mid-stream — a race only real streaming latency opens.

### Seam 11 — Deploy-drain mid-stream

- **State that crosses:** a backend drain/restart signal vs. new and in-flight turns.
- **Enforced by:** `convex/control/drain.ts:isDrainingNow` / `countActiveGenerations`
  (singleton `backendControl` row). New turns are refused at the
  `chat_turn.ts:chatWithAgentTurn` gate → `BACKEND_DRAINING`; in-flight turns keep
  running; queued messages defer while draining; the CLI waits for `inFlight === 0`.
- **Invariant:** during a drain, no new turn starts, but in-flight turns complete
  before shutdown.
- **Has broken:** — (a designed-in guard; no headline regression, listed so a change
  to the send gate or generation lifecycle is checked against it).
- **Hidden condition (blind spot #1 + #4):** a deploy/restart _during_ an active
  stream on a real instance — never reproduced by a single local `bun dev` process.

### Smaller siblings of blind spot #4 (fold into the seam they touch)

These are the same "happy path hides the general bug" shape and are checked under
Seams 2/6/9:

- **Server re-enforcement of client caps** — `convex/agents/chat_turn.ts:validateChatAttachmentCaps`
  now re-checks attachment count/size/type server-side inside `chatWithAgentTurn`
  (the guard #2661 asked for). Any new client-side cap needs a server twin here.
- **Tool availability vs. prompt** — #2760 (Issue, closed): a transcript attachment
  told the model to call `document_retrieve` even when the agent lacked that tool. A
  prompt must not advertise a tool the agent doesn't have.
- **BYO backend degrade** — #2755 (Issue, closed): a BYO knowledge DB without
  `pg_search` threw instead of degrading to vector-only. A bundled backend hides the
  BYO failure mode.

---

## PR seam-checklist

For any chat PR, ask each question. If **yes**, exercise that seam **under its hidden
condition** — not on zero-latency single-org localhost with a bundled agent and the
mock provider, which is exactly where these bugs hide.

| #   | Seam                | This change touches it if it…                                                  | Exercise it under…                                                                                                                                           |
| --- | ------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Active-org          | adds/alters a by-id thread or message read/write, or an org-scoped query       | **A 2-org session:** one user in orgs A+B, open a thread in A, switch to B with it open — the read must return B's data / nothing, never A's.                |
| 2   | External-agent lock | changes agent selection, the optimistic `agentSlug` patch, or step 0           | **A real external agent** installed: switch agents with another thread open / send mid-turn — the locked agent must win over the stale client slug.          |
| 3   | Branch files        | changes branch/fork state, `threadFiles`, delegate sub-threads, or the listing | **A branched thread with ancestor files:** confirm it sees ancestors only up to the fork point, and the tip's own files are uncut.                           |
| 4   | Optimistic swap     | touches the optimistic bubble, thinking shell, message ordering, or timers     | **A deployed / artificial-latency instance** (not `bun dev`): watch for flash, remount, duplicate, or timer rewind on send and on route open.                |
| 5   | Turn-shape / retry  | changes retry, stop-conditions, or finish-reason handling                      | **A real provider** that emits unlabelled finishes and reasoning-only / tool-only turns: confirm no spurious ⚠ retry marker and no doubled generation.       |
| 6   | @-mention           | changes reference resolution, KB access, or attachment handling                | **A referent that changes between pick and send** (delete / de-index / move out of the user's teams): confirm one opaque `KB_REF_INVALID`, no leak.          |
| 7   | Auto-route → UI     | changes routing, the route cache, or `liveRoute` / the pickers                 | **A thread route mount under latency** + a real classifier: the pickers must not paint blank, and an idle thread must not carry a stale route.               |
| 8   | projectId           | changes project binding, project-scoped refs, or project access                | **A multi-org / multi-project session:** a project from another org must not bind or resolve; expect `PROJECT_MISMATCH` / `PROJECT_ORG_MISMATCH`.            |
| 9   | Model RBAC          | changes model selection, tool availability, or governance                      | **A custom / minimal / BYO agent** (not a bundled one): RBAC denial is audited; tools the agent lacks are never advertised; BYO backends degrade, not throw. |
| 10  | In-flight supersede | changes the send path, cancel, queue, or abort watcher                         | **A send while a turn is mid-stream** (real latency): the prior turn cancels-then-restarts (chat) or enqueues (external); the indicator stays stable.        |
| 11  | Deploy-drain        | changes the send gate or the generation lifecycle                              | **A drain during an active stream:** new turns get `BACKEND_DRAINING`; the in-flight turn still completes before shutdown.                                   |

**The recurring conditions this checklist forces:** a 2-org session · a deployed /
artificial-latency instance · a real provider · a custom / minimal / BYO agent · and
an adversarial read of the changed handler against its correctly-gated sibling.

---

## Maintenance & known gaps

- **Keep truthful.** Moving a chat seam updates its entry here in the same PR
  (create-pr "Docs" gate). If a seam is added or removed, update the Seam Map **and**
  the checklist table together.
- **Open issues referenced above:** #2716 (composer pickers paint blank on a thread
  route — Seams 4 & 7) and #2767 (spurious model-fallback banner on a text-less
  human-input pause — Seam 5).
- **Stale schema comment (Seam 3), not a code bug in this map's scope:**
  `convex/threads/branch_schema.ts` says the fork cut is `threadFiles.createdAt <=
forkOrderCreatedAt`, but `convex/thread_files/queries.ts:listThreadFilesForUser`
  deliberately cuts on `updatedAt` (in-code rationale: `upsertThreadFile` bumps only
  `updatedAt`). The prose is out of date; the code is correct. Fix in a separate
  change.
- **Candidate seams for a later pass** (verified to exist, not yet mapped here): RAG
  retrieval scope → per-org knowledge pool (`getKnowledgePoolForOrg`), streaming
  HTTP-action auth (`convex/streaming/http_actions.ts`), delegate/sub-agent thread
  file inheritance, image-generation budget.
