# Design: `run_code` on a per-thread persistent session (turn-scoped lifecycle)

Status: **proposed** · Scope: chat `run_code` execution model · Owner: platform+sandbox

## 1. Problem

The chat `run_code` tool runs each call in a **fresh, ephemeral container**
(`services/sandbox/src/backend/local-workspace-run.ts`: create workspace →
stage inputs → run → harvest `/user/output` → `rm -rf`). Nothing survives
between calls; state is reconstructed every call from Convex. That produces
three user-visible failures, all observed in a real thread
(`m572q0tkx4yvfpb3dpsw5gq7p989pcbt`, panda `.pptx`):

1. **Duplicate output files.** To let a script _read_ prior outputs, the
   platform re-stages every prior `run_output` file back into `/user/output`,
   and `harvestOutputDir` re-uploads **everything** it finds there
   (`exec-common.ts:770` — computes a `sha256` per file but never compares it
   to the staged priors). So an unchanged `认识熊猫.pptx` was re-harvested on
   6 of 10 `run_code` calls and — after the recent "harvested file → chat
   card" change — surfaced as the **same download card 4×**.
2. **Packages don't persist.** Each call re-installs and the model must
   re-declare `packages` every time (`markitdown[pptx]` re-declared across
   calls). Forget it once and the import fails.
3. **Scratch files don't persist.** Only `/user/output` is harvested; anything
   a script writes to `/user/code` or `/tmp` is gone next call. The model must
   "cleverly" re-materialize its own working state — the exact fragility we
   want to remove.

Secondary friction from the same trace: no "install only" affordance, so the
model invents `run_code({entryPath: "/dev/null"})` (3× `INVALID_STEP_PATH`),
and once passes `entryPath` + `steps` together (mutual-exclusivity error).

**Goal:** within a thread, previously installed packages, written files, and
produced outputs **just stay there** across `run_code` rounds — without relying
on the model to re-carry them — while the UX stays **simple, stable, and
consistent** (identical canvas / download cards; no new model-facing tools; no
leaks).

## 2. Approach (one line)

Run chat `run_code` inside a **persistent per-thread sandbox session**
(`thr-<threadId>`), created lazily on the first `run_code` of a turn and
**stopped (workspace preserved) at turn end** by the harness — never destroyed
until the thread is deleted or the idle-reaper's TTL fires. This reuses the
existing session infrastructure (`services/sandbox/docs/sessions.md`) that
external agents already run on, and the _scoped-session_ lifecycle the
workflow sandbox-step already uses (`sessionIdForWorkflowRun`, torn down at
step end).

The lifecycle is **harness-managed, not a model tool.** "Always stop at message
end" can only be _guaranteed_ by a `finally` at turn completion — a
`create_sandbox`/`close_sandbox` tool would reintroduce "rely on the model to
remember" (and leak on error/cancel, where the model never gets to call
`close`). The model keeps seeing exactly one tool: `run_code`.

## 3. Why per-thread, and why stop (not destroy)

| Decision        | Choice                                                        | Why                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolation key   | **per-thread** (`thr-<threadId>`, `ownerType:'thread'`)       | A chat thread ≈ one task ≈ one workspace. Per-**user** (`usr-…`, what external agents use) would leak thread A's files/packages into thread B.                                                                                                                                                     |
| Turn-end action | **stop-preserve**, not destroy                                | Stop releases compute but keeps the workspace (host bind-dir / per-session PVC — `sessions.md` §"Stop vs destroy"). Next turn _resumes_ the same id → packages + files + outputs persist across turns. Honors "close at message end" (compute) **and** "state persists across rounds" (workspace). |
| Destroy         | thread delete, or reaper TTL on long-idle                     | Only explicit destroy deletes a workspace.                                                                                                                                                                                                                                                         |
| Profile         | `default` caps, but **persistent** (no cumulative-CPU ulimit) | run_code is untrusted user code (uid 65534, keep one-shot hardening), but the container is long-lived so the cumulative-CPU kill must be off (as `agent` profile already does). Introduce a `run_code` profile = `default` hardening + long-lived tunables.                                        |

This is **not** the external-agent per-user "computer"; it is a scoped,
per-thread session with the same stop/resume/reaper machinery.

## 4. Lifecycle & hook points

```
turn starts (startAgentChat → runAgentGeneration streamText loop)
      │
      │  … model calls run_code (1st time this turn) ───────────────┐
      │                                                             ▼
      │                                            ensureThreadSession(threadId)
      │                                              getActiveSessionByOwner('thread', threadId)
      │                                              ├─ none  → reserveSessionSlotAndInsert (cap/FIFO park)
      │                                              │          → sessionCreate(thr-<id>, profile:'run_code')
      │                                              │          → setSessionStatus(active)
      │                                              └─ stopped→ sessionIsAlive? no → sessionCreate(same id)  // resume
      │                                                          → resumeStoppedSession (reset TTL, keep createdAt)
      │  … run_code exec (drainSessionExecResilient) …            │
      │  … harvest NEW/CHANGED /user/output → threadFiles …       │  (subsequent run_code reuse the session)
      │                                                            │
turn ends  →  clearGenerationStatus(threadId, streamId)  ─────────┘
      │        (single convergence point: normal / error / cancel / stale-recovery)
      │        if queue NON-empty (settleQueueOnTurnEnd → next turn): KEEP session warm
      │        else schedule stopThreadSession(threadId)  // action: sessionCancelExec(live) then stopSession
      ▼
session STOPPED (workspace preserved) → next turn resumes it
```

- **Create hook:** first `run_code` of a turn. `run_code_tool.ts` already has
  `threadId` in `ctx`; it ensures/reuses the `thr-<threadId>` session and
  dispatches the exec into it instead of `spawnerExecute`.
- **Vision lane (on create AND resume-after-reap):** right after
  `sessionCreate`/`resumeStoppedSession`, `armVisionLane`
  (`node_only/sandbox/thread_session.ts`) best-effort mints a gateway virtual
  key scoped to ONLY the org's vision-tagged model
  (`RUN_CODE_VISION_BUDGET_CENTS`, default 200¢/session), inserts its
  `sandboxSessionTokens` row (with `llmGatewayKeyId`, so the normal teardown
  revoke covers it), then patches
  `TALE_GATEWAY_URL`/`TALE_GATEWAY_TOKEN`/`TALE_VISION_MODEL` into the session
  env store — the contract the baked `tale-vision` CLI reads from run_code
  execs. Any failure logs and the session comes up without vision (the CLI
  exits 2 with an actionable message). A reaped-then-recreated container
  always re-mints: the plaintext key exists only in the container's in-memory
  env store; the superseded row stays budget-capped until teardown revokes
  every row of the session.
- **Stop hook:** `clearGenerationStatus` (`threads/internal_mutations.ts:427`)
  is the one place every terminal path converges (normal completion, user
  cancel, 35-min stale-recovery). It's a _mutation_, so it **schedules** an
  action `stopThreadSession` rather than calling the spawner inline — and only
  when the thread truly settles to idle (`settleQueueOnTurnEnd` reports no
  queued messages). A queued burst of user messages keeps the session warm
  across the drained turns.
- **Reaper backstop:** the existing idle/TTL reaper (`sweepExpired`) stops any
  session whose runnerd `lastActivityAtMs` goes idle — so even if the stop hook
  is missed (crash between turn-end and the scheduled action), nothing leaks.
  Live-exec sessions are already spared, so a mid-turn reaper pass can't kill an
  in-flight `run_code`.

## 5. Outputs: keep `threadFiles` as the materialized view (compat-preserving)

Downstream consumers all read `threadFiles(source:'run_output')`: the Canvas
output dock (`workspace-file-tabs.tsx` `WorkspaceOutputDock`), the chat file
cards (`appendFilePart`), and `file_read`/`file_list`. **We keep populating
`threadFiles`** so every consumer is unchanged — the persistent workspace is the
source of truth, `threadFiles` is its materialized mirror.

After each `run_code` exec, harvest is **incremental**: list `/user/output` in
the session and upsert to `threadFiles` **only** files whose `sha256` differs
from the row already stored (or absent). This single rule:

- kills the duplicate-card / duplicate-upload bug (unchanged files are skipped —
  this _subsumes_ the standalone "skip unchanged priors" fix);
- means the deliverable is carded exactly once, when it first appears or
  changes;
- needs no re-staging of priors (they're already in the live workspace), so the
  whole `priorOutputDownloads` round-trip disappears for session runs.

`file_read`/`file_list` continue to read `threadFiles` (consistent snapshot as
of the last harvest); reading the _live_ session FS is a possible v2 refinement,
not required for correctness.

## 6. Inputs: user uploads, code files & packages

Three input classes, all already modeled as `threadFiles` sources; in the
persistent session they are staged **once** into their stable dirs and then
just stay there:

- **User uploads (`source:'user_upload'` → `/user/uploads/<name>`).** This is a
  first-class flow, not an afterthought: a user drops a `report.pptx` and says
  "edit this". The upload is staged into the session's `/user/uploads/`, the
  model reads it via ordinary sandbox code (`python-pptx`, `openpyxl`, …),
  transforms it, and writes the result to `/user/output/<new>.pptx` — which
  incremental harvest surfaces as a download card. The **round-trip
  (upload → read → edit → new output)** must work end-to-end and is a headline
  acceptance test. In the persistent model the upload persists across every
  `run_code` round without re-fetching, so a multi-step edit (read → adjust →
  re-render → QA) never loses the source file. New uploads arriving mid-thread
  are staged incrementally (by sha256, same reconcile rule).
- **Code files (`source:'agent_write'` → `/user/code/<path>`).** `file_write`
  writes to `threadFiles` (unchanged) **and** stages straight into the live
  session (`sessionStageFiles`) so the script is present without a full
  re-stage next call. On a cold resume the session is re-hydrated from
  `threadFiles` once (idempotent, by sha256).
- **Packages.** Installed in a turn, they persist in the workspace (pip/npm
  target under the persistent `/user`), so re-declaring `packages` becomes
  optional, not required. This removes the `/dev/null` "install-only" hack: a
  bare `pip install …` step in a persistent session simply persists. (The
  first-class "prepare env" call shipped as `run_code`'s `mode: "install"` —
  packages-only, no script.)

## 7. `run_code` always returns the sandbox state manifest

Today the tool result reports only _this run's_ harvested files, so the model
has to reconstruct "what's in the sandbox" from memory or extra `file_list`
calls — again leaning on cleverness. Instead, **every `run_code` result carries
a compact manifest of the full current sandbox state**, so the model's picture
is always ground-truth and self-correcting:

```
sandbox state (thr-<id>):
  uploads   /user/uploads : report.pptx (2.1 MB)
  code      /user/code    : gen.py, convert.py, content_qa.py
  outputs   /user/output  : 认识熊猫.pptx (0.9 MB), slide-1.jpg … slide-7.jpg
  packages  python        : python-pptx, markitdown
            node          : pptxgenjs, sharp
  session   resumed (warm) · cwd /user/code
```

Properties:

- **Always present**, on success _and_ failure (a failed run still reports what
  exists), and bounded (counts + truncation when a dir is large) to stay cheap.
- **Ground-truth**, read from the live session (or the post-harvest
  `threadFiles` snapshot on the ephemeral path), not accumulated by the model.
- Makes the manifest the model's single source of truth: it can see the upload
  it must edit, the outputs it already produced (so it won't regenerate), and
  the packages already installed (so it won't re-declare). This directly
  attacks the duplicate-generation and re-install behaviors, independent of the
  persistence work — so the manifest is worth shipping on the **ephemeral path
  too**, as an early, standalone improvement.
- Each entry is identified by its **absolute workspace path** — the same
  identity every other file tool uses. Structured field
  `sandboxState: { uploads[], code[], outputs[] }` where each file is
  `{ path, fileId, size, contentType }` (`fileId` = storage id, the handoff
  token to the `image` / `document_write` tools), plus a short human-readable
  rendering on the result message. Reported on every run, success or failure.
  (Implemented on the ephemeral path today; `packages` joins it with the
  persistent session, which has durable installed-package state.)

**Path is the file identity; the storage id is a handoff token, not a second
identity.** The sandbox is a filesystem — the model writes scripts against
paths, and every _file_ op (`file_read`/`file_write`/`file_delete`/`run_code`)
speaks paths. Path is also the _stable_ handle: a file's `_storage` blob id
changes on every overwrite, whereas the path is durable — so path, never id, is
what the model references for file ops. **But** the id-consuming tools already
exist in the contract: the `image` tool (`analyze`) and `document_write` both
take a `_storage` id (uploads already surface one via the attachment context).
Rather than migrate those to paths, **`file_list` returns each file's `fileId`
(its storage id)** as a _handoff token_ to them — path stays the identity,
`fileId` is a use-it-now bridge (stale after an overwrite). The read side is the
**manifest (what exists, by path)** + **`run_code` stdout**; `file_read` stays
for the occasional small-text peek. No content-read tool, no live-FS read path.

**Unify on the absolute sandbox path — as a mapping layer, no DB change.**
`source` already implies a root (`user_upload`→`/user/uploads`,
`agent_write`→`/user/code`, `run_output`→`/user/output`) — that's exactly how
`run_code` stages files today. So the absolute sandbox path is a **pure
derivation** of the existing `(path, source)`, and we express it as one shared
**mapping layer**: `absolute = ROOT[source] + '/' + relpath` and back. That
mapping — today implicit and duplicated across staging, the prompt guidance, and
the model's head — becomes the single source of truth.

- **`threadFiles` is unchanged and stays sandbox-agnostic.** Crucially, **not
  every thread with files needs a sandbox**: a bare upload the model reasons
  about, an `.md`/`.html` the model `file_write`s that just renders in the
  Canvas — these never start a container. `threadFiles` remains the neutral
  store; the sandbox path is a _view_ the mapping computes, and resolving it is
  **pure** (no running container needed). `file_read("/user/output/x")` → map →
  `(relpath "x", source run_output)` → `threadFiles` lookup, sandbox or not.
- **The file tools stay neutral; the sandbox path is an accepted alias, not the
  default.** `file_read`/`file_list`/`file_write`/`file_delete` **emit** the
  neutral workspace path + `source` (so a no-sandbox thread never sees `/user/…`
  framing), but **accept** the absolute `/user/…` alias on input — so pasting a
  path straight from a `run_code` script just works. `run_code` `entryPath`
  accepts the `/user/code/…` alias the same way. Staging/harvest use the mapping
  to place/collect files in the real FS. (The earlier "everything emits `/user/…`"
  idea was rejected: it bakes the sandbox into the neutral file layer.)
- **No migration, no data rewrite, no drop.** `validatePath` accepts the
  `/user/{uploads,code,output}/…` roots (still rejecting `..`/escapes).
- Provenance stays tied to the _creating tool_ (`file_write`→`/user/code`,
  `run_code`→`/user/output`, upload→`/user/uploads`), so the mapping is total
  and unambiguous.
- Residual: `threadFiles` is still keyed `(threadId, path)`, so the _same
  relpath under two roots_ collides (rare, avoidable). If it ever bites, tighten
  the key to `(threadId, path, source)` — still no backfill (rows already carry
  both).

**`document_write` after the tool removal:** it takes a `fileId` (`_storage`
id) — a contract built around the generation tools this work deleted. Rather
than migrate it to a path, the `file_list` **`fileId` handoff token** (above)
closes the gap: the model lists a `run_code` output, reads its `fileId`, and
hands that to `document_write` (or the `image` tool). No path-native variant is
required, though it remains a possible future cleanup.

## 8. Edge cases (the correctness contract)

| Case                                        | Handling                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Concurrent run_code in one thread**       | Chat is serialized (`generationStatus` is binary; OCC on `streamId`) → at most one turn, one `run_code` at a time. The session exec path also serializes per session. No `/user/output` clobber.                                                                                                                          |
| **User cancel (Stop)**                      | `cancelGeneration` already cascades `cancelSessionExecsForThread` (SIGTERM→SIGKILL the exec) and hits `clearGenerationStatus` → schedules stop. Workspace preserved; next turn resumes.                                                                                                                                   |
| **New message mid-turn**                    | Enqueued; `settleQueueOnTurnEnd` drains into the next turn with a fresh `streamId`. Session is **kept warm** (no stop between drained turns).                                                                                                                                                                             |
| **Turn spans >1 action / 10-min cap**       | The session outlives any single action (it's a container, not an action). The exec uses `drainSessionExecResilient` (re-attach by `sinceSeq`), and the durable op row + checkpoint already survive action death for the external-agent path — reused here. Stop fires only at true turn end, never at an action boundary. |
| **Server crash mid-turn**                   | `recover_stuck_chat_turns` (35-min stale sweep) finalizes the turn and must also schedule `stopThreadSession`; the idle reaper is the final backstop. Exactly-once stop is idempotent (`sessionIsAlive`/stop tolerate already-stopped/gone).                                                                              |
| **Deploy drain**                            | Draining defers queue drain until after shutdown; sessions are stop-preserved, re-adopted on boot (`adoptExisting`).                                                                                                                                                                                                      |
| **Capacity exhausted**                      | `reserveSessionSlotAndInsert` per-org cap → FIFO **parking** (already built for chat source): the `run_code` call parks and retries on a capacity-wake instead of failing. Per-owner cap = 1 active session per thread (natural).                                                                                         |
| **Resume race / 409**                       | `sessionCreate` on an id already live returns 409 → reuse it; `resumeStoppedSession` is idempotent.                                                                                                                                                                                                                       |
| **Stop while an exec is (somehow) running** | Reaper spares live-exec sessions; the explicit turn-end stop first `sessionCancelExec`s, then stops.                                                                                                                                                                                                                      |
| **Output quota / large files / truncation** | Enforced spawner-side at harvest (16 files/run, per-file + total caps) — unchanged; incremental harvest only _reduces_ what's uploaded.                                                                                                                                                                                   |
| **Thread branching / delete**               | Branch = new `threadId` → new session (isolated). Delete cascades `deleteOpsForThread` + a `destroySession(thr-<id>)` to free the workspace.                                                                                                                                                                              |
| **Sub-agents / non-chat run_code**          | No clean per-thread turn boundary → **stay on the ephemeral one-shot path** (or a workflow-run scoped session). Session-backed run_code is gated to top-level chat threads.                                                                                                                                               |
| **Upload edit round-trip**                  | User uploads `report.pptx`, edits it over several `run_code` rounds. The upload persists in `/user/uploads`; the source file is never lost between read → edit → re-render → QA. New output `.pptx` is carded once (incremental harvest). This is a required acceptance test.                                             |
| **Upload replaced mid-thread**              | A re-uploaded file at the same name updates `/user/uploads` (sha256 differs → re-staged); the manifest reflects the new size so the model edits the right version.                                                                                                                                                        |

## 9. UX invariants (simple · stable · consistent)

- **Simple:** the user sees no new concept and the model sees no new tool — one
  `run_code`. Files still land in the Canvas dock and as download cards.
- **Stable:** exactly-one card per distinct deliverable (incremental harvest);
  the workspace is never silently destroyed (stop-preserve + explicit-destroy-
  only); no leaked containers (turn-end stop + reaper backstop).
- **Consistent:** every turn behaves the same — prior packages/files/outputs are
  present on the next `run_code`, whether it's the next step or the next
  message, and the **state manifest** (§7) on every result means the model never
  has to guess what's there. The only observable difference vs today is _fewer_
  surprises.
- **Tradeoff to tune:** stop-on-turn-end means the next message pays a **resume**
  (container recreate + runnerd boot, seconds). If that hurts, switch the stop
  trigger from "immediately at turn end" to "reaper idle grace (e.g. 2–5 min)"
  so quick follow-ups stay warm. Recommend shipping with a short idle grace
  rather than instant stop.

## 10. Blast radius

- **Change:** `run_code_tool.ts` (dispatch to session when chat-scoped +
  incremental harvest), a new `ensureThreadSession` / `stopThreadSession`
  action pair (thin wrappers over `session_client` + `session_mutations`), a
  stop-schedule call in `clearGenerationStatus` / `cancel_generation` /
  `recover_stuck_chat_turns`, `file_write` live-stage, a `run_code` resource
  profile, and thread-delete → `destroySession`.
- **Vision lane:** `armVisionLane` in `thread_session.ts` (mint + token row +
  env patch, best-effort), the baked `tale-vision` CLI + its Pillow venv in
  the runtime image, and one VISION line in the `run_code` tool description.
  Teardown/revoke paths unchanged — the token row's `llmGatewayKeyId` rides
  the existing `revokeTokensForSession` sweep.
- **Unchanged (the compat win):** Canvas, file cards, `file_read`/`file_list`,
  `threadFiles` schema, all read `threadFiles` as before.
- **Reused as-is:** `session_client` (create/exec/attach/stop/destroy/stage/
  cancel), `drainSessionExecResilient`, capacity/FIFO parking, the reaper,
  adopt-on-boot, durable op rows + checkpoints.

## 11. Rollout

1. **Flag-gated** (`SANDBOX_RUNCODE_SESSIONS` per-org/global). Off → today's
   ephemeral path, untouched. Fallback to ephemeral if session
   create/resume fails (never fail a `run_code` because sessions are down).
2. Land two **standalone, ephemeral-path** wins first — both low-risk,
   independently testable, and prerequisites for the session path:
   (a) **incremental harvest** (skip unchanged by sha256) → fixes the
   duplicate-pptx bug today; (b) the **state manifest** (§7) on every result →
   stops re-generation / re-declaration today.
3. Enable session-backed run_code for internal/dogfood threads; watch capacity,
   resume latency, orphan sessions; verify the upload→edit→output round-trip.
4. Default on.

## 12. Alternatives considered

- **Per-user session for run_code** (reuse `usr-…` like external agents):
  rejected — cross-thread contamination breaks isolation.
- **Model-facing `create_sandbox`/`close_sandbox` tools:** rejected — cannot
  guarantee "always close" (error/cancel paths never reach the model), and
  re-introduces reliance on model discipline. Keep it harness-managed. (A
  `reset_sandbox` escape hatch for "my env is dirty, start clean" is a possible
  minor addition, default unused.)
- **Session-only outputs (drop `threadFiles`):** rejected for v1 — would force
  Canvas / file cards / `file_read` onto a live-session data source
  (`workspace_files.ts`), a much larger, riskier change. Keep `threadFiles` as
  the materialized mirror; live-FS reads are a v2 refinement.
- **Just fix the duplicate harvest, keep ephemeral:** necessary but
  insufficient — it fixes duplicates but not package/scratch persistence, which
  is the root of the model's "cleverness" burden.

## 13. Open questions

1. Stop trigger: **instant on turn-end** vs **short idle grace** (recommend the
   latter for follow-up latency). Value of the grace?
2. `run_code` session profile caps (CPU/mem/pids) vs the one-shot `default`.
3. Workspace GC policy for stopped per-thread sessions (destroy after N days
   idle? on thread archive?) — bounds preserved-workspace storage.
4. **Path is the single file identity** (§7): the model never sees storage ids.
   Follow-up — migrate `document_write` from `fileId` to a **workspace path**
   (resolve internally) so the last id-based file tool matches the rest. No
   live-FS content-read tool is built.
5. Capacity sizing: every active thread doing run_code now holds a session —
   confirm per-org caps + FIFO parking absorb the new load.

```

```
