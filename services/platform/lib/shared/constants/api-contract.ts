/**
 * The version of the REST contract `/openapi.json` describes (`info.version`)
 * — semver for the wire, not for the deployment: a minor bump for an
 * additive change (a new operation, field, header or error code), a major
 * one for a removal or a changed meaning. Every `/api/v1` response carries
 * it as `X-Tale-Api-Version`, and `scripts/openapi/spec.test.ts` refuses a
 * contract whose operation or schema fingerprint moved without a bump, so
 * the number a client pins to cannot stay still while the surface changes.
 *
 * 1.4.0 — 2026-09-12: the 09-12 evaluation's contract changes (a blank
 * `cursor`/`limit` refused, key-less `OPTIONS`, `414` for an over-long URL,
 * declared response headers, `X-Tale-Api-Version`), on top of the nine
 * operations #3329 added under the unchanged 1.3.0.
 *
 * 1.5.0 — 2026-09-13: the 09-12 evaluation's fourth pass — every keyset and
 * offset list answers `isDone` + `continueCursor`, `x-tale-pagination` on
 * every list schema, `reasoningSince` on the generation poll, a queued send
 * can be stopped, `201` on a skill create, the door-wide `408`
 * `REQUEST_TIMEOUT`, page failure facts on websites, trigger health on the
 * automation summary, `size` on project files, `archivedAt` on tasks.
 *
 * 1.6.0 — 2026-09-13: the 09-13 evaluation's fifth pass — a project file's
 * own `retry-indexing` door, `testsCheckedAt` on automation versions, `id`
 * beside `runId` on run rows, `404`/`409` on a task start naming an unknown
 * or undeployed automation, `400` `INVALID_HEADER` for an `Idempotency-Key`
 * outside printable ASCII, the edge's own `BODY_LENGTH_MISMATCH` (400) and
 * `UPSTREAM_UNAVAILABLE` (502/503/504) envelopes, `X-Tale-Api-Version` on
 * the webhook doors, `If-Modified-Since` declared on the document download.
 *
 * 1.7.0 — 2026-09-14: `setupFolderName` on the task intake — a root folder
 * of the project, bound by name as the task's `externalUrl` the way the
 * app's desks bind it — with its `400` `SETUP_FOLDER_MISSING`.
 *
 * 1.8.0 — 2026-09-14: recipient-scoped personal and organization notification
 * export, with signed pagination cursors and the app's own deep links.
 *
 * 1.9.0 — 2026-09-14: the 09-14 evaluation's seventh pass — a conversation
 * mirror's receipt carries `externalContactId` and `contactStatus`, and a
 * content snapshot for a trashed contact answers 409
 * `CONVERSATION_CONTACT_TRASHED`; `If-Match` on the document update (412
 * `PRECONDITION_FAILED`); the contacts bulk import validates rows one at a
 * time (`errors[].issues`, `INVALID_BODY` per row); a blank or over-long
 * `Idempotency-Key` answers 400 `INVALID_HEADER`; `contacts?source=` is the
 * closed set; `products.imageUrl` refuses private and metadata hosts; a
 * contact, product or project `PATCH` that changes nothing writes nothing;
 * `Automation.document.version` is the integer it always was. Runs carry
 * `failureCode` (one enum over the engine's, the provider's and the agent's
 * causes) and a cancel answers the run's `status` beside `cancelled`;
 * `GET /api/v1/me` answers `capabilities.developer`; the single-file read
 * `GET /projects/{id}/files/{documentId}`; `documentIndexing.errorCode` is
 * the closed RAG vocabulary (terminal `unsupported` causes named);
 * `Website.status` is an enum and `websites?status=` refuses a value
 * outside it; `WebsitePage.lastErrorKind` gains `unsupported_content`,
 * `robots_noindex` and `tls_error`; a 429 carries a sentence and
 * `requestId` like every refusal; the edge's own 400 `BODY_CHUNK_MALFORMED`.
 *
 * 1.10.0 — 2026-09-14: `folderId=root` on `GET /api/v1/documents` and
 * `GET /api/v1/projects/{id}/files` lists the documents (files) in no
 * folder — the root a folder id could never name; omitting the parameter
 * still lists everything, whatever folder a row sits in.
 *
 * 1.11.0 — 2026-09-15: the 09-14 evaluation's eighth pass — `Location` on
 * every 201 that creates one addressable resource; `POST
 * /api/v1/contacts/{id}/restore` (the remedy a frozen mirror's 409 names)
 * and `GET /api/v1/conversations` (every mirror under a source, `contactStatus`
 * narrows); the mirror receipt carries `contactId` and a re-keyed contact's
 * binding follows its current `externalId`; `harnesses` on `GET /models` and
 * `PROJECT_AGENT_HARNESS_INVALID` naming them; the skill file read is
 * validated (`ETag`, `Last-Modified`, 304); the document `PATCH` answers its
 * `ETag`; a thread `PATCH` that archives a thread mid-turn answers 409
 * `CHAT_TURN_IN_PROGRESS`; `websites?scanInterval=` refuses a value outside
 * the set; `Website.status` loses the never-observable `idle`; a `null`
 * listed in every nullable enum; `KnowledgeDiagnostics.dense`; the knowledge
 * `query` cap named (2000); `ContactInput` and `ProductInput` declare their
 * nullable fields; the MCP `start_run` tool takes `idempotencyKey`,
 * `set_trigger` answers a webhook token once with `deployed`,
 * `get_automation` reads `version: "deployed"`, `list_versions` marks the
 * deployed one, and every capability refusal carries a `code`.
 *
 * 1.12.0 — 2026-09-15: the 09-15 evaluation's ninth pass — `MessagePart` is
 * a discriminator over seven named part schemas (`TextPart` …
 * `HumanInputPart`) with an explicit `mapping`, so a validating client
 * accepts every message; `recipientId` on the notification export is
 * `nullable`, not a 3.1 type list; the conversation mirror receipt carries
 * `sourceDeleted` and `status`, and a content snapshot onto a torn-down
 * mirror answers 409 `CONVERSATION_CLOSED` instead of reopening it.
 *
 * 1.13.0 — 2026-09-15: budget caps bind the REST chat send — a cap that
 * binds the key holder (their own, one of their teams', the organization's
 * or the API key's) refuses `POST …/messages` with 429 `BUDGET_EXCEEDED`,
 * naming the cap in `data` (`scope`, `period`, `limitCode`, `used`,
 * `limit`, `resetsAt`) beside `Retry-After`; a cap reached after the 202
 * settles the reply with errorCode `budget_exceeded`; and a keyed turn's
 * usage counts against the key's own caps.
 *
 * 1.14.0 — 2026-09-16: the notification export can be delegated without an
 * admin seat — a member holding a live `tale:notifications.export`
 * capability (a competence-register grant an organization admin makes and
 * revokes: organization-scoped, optionally expiring, revoked with the
 * membership) passes `GET /api/v1/notifications/sync`, whose 403
 * `ROLE_FORBIDDEN` names the capability; `GET /api/v1/me` answers
 * `capabilities.notificationExport`.
 *
 * 1.15.0 — 2026-09-18: the round-J evaluation's contract fixes.
 * `Run.failureCode` (and `RunProjection`/`RunSummary`) no longer lists
 * `budget_exceeded` twice, so `openapi.json` validates as OAS 3.0.3 and
 * `openapi-python-client` no longer aborts (J9-1). `WebsitePage.lastErrorKind`
 * gains `host_not_allowed` — a redirect off the registered site, which used
 * to wear the `private_ip` label (J6-6). `GET /api/v1/skills/{slug}/files/{path}`
 * declares its conditional GET (`If-None-Match`/`If-Modified-Since`, 304,
 * `ETag`/`Last-Modified`) the door already answered (J1-1). `Product.currency`
 * accepts any case (`^[A-Za-z]{3}$`), matching the door (J7-1).
 * `WebsiteSearchResults.total` is the count of all matches, not the page size
 * (J6-9). `createdBy` names `system:provisioning` (J3-3). `/openapi.json`
 * carries an `ETag` and answers 304 (J9-2). Documentation only elsewhere:
 * the chat send's UTF-16 content cap (J2-1).
 *
 * 1.16.0 — 2026-09-18: a run's question and a task's review get their REST
 * twins, and a machine caller can act FOR a member. `GET …/runs/{runId}/ask`
 * answers the `PendingAsk` a run waits on (or null) and
 * `POST …/runs/{runId}/asks/{askId}` `{answer, actor?}` records the answer,
 * resumes the run and mirrors the answer onto the task timeline; the
 * app-only codes `EMPTY_ANSWER`, `HUMAN_ASK_NOT_FOUND`,
 * `HUMAN_ASK_NOT_PENDING` and `HUMAN_ASK_EXPIRED` join the registry.
 * `GET …/tasks/{taskId}/review` answers the pending `TaskReview` beside the
 * task's status, and `POST …/tasks/{taskId}/review`
 * `{decision, comment?, workflowSlug?, actor}` approves (the move to Done,
 * policy-checked as on the board) or requests changes (comment + restart),
 * with `TASK_NOT_IN_REVIEW`, `TASK_HAS_OPEN_SUBTASKS`,
 * `REVIEW_INDEPENDENT_REVIEWER_REQUIRED` and `REVIEW_COMPETENCE_REQUIRED`
 * on the wire. `Actor` names the member by verified e-mail — resolved
 * with the notification export's membership rule, pinned by `userId` —
 * and answers `ACTOR_NOT_FOUND`, `ACTOR_AMBIGUOUS`, `ACTOR_UNVERIFIED`,
 * `ACTOR_DISABLED` or `ACTOR_REBOUND`; naming one needs the new
 * `tale:rest.act-as` capability (or an admin seat), which `GET /api/v1/me`
 * answers as `capabilities.actAs`.
 *
 * 1.17.0 — the team AUDIENCE, one vocabulary for who may see a document or
 * a project: `Project.teamIds` (always present; empty = organization-wide)
 * joins the payload, and `teamIds` is accepted on the project create and
 * patch bodies (`PATCH …/projects/{id}` `{teamIds}` sets the audience, an
 * admin verb). `Document.teamIds` joins the document payload beside the
 * now-deprecated single `teamId`, and `teamIds` is accepted on the document
 * create and patch bodies (`teamId` stays as its single-team spelling). A
 * document inside a team folder takes the folder's audience
 * (`TEAM_INHERITED_FROM_FOLDER` when a request names a team outside it);
 * an audience naming a team that is not the organization's is
 * `TEAM_NOT_IN_ORG`; a project audience that is too long or repeats a
 * team is `PROJECT_SHARING_INVALID`. Owners and admins now read every
 * team-scoped hub document and folder, as they already did every project.
 *
 * 1.18.0 — task discussion reads and comment writes preserve optional
 * `bodyByLocale` snapshots so clients render workflow progress in the reader's
 * selected language. Writes require en/de/fr and accept additional locale keys;
 * plain-text edits clear stale translations.
 *
 * 1.19.0 — the 2026-09-19 round-K evaluation's contract corrections.
 * `GET /api/v1/teams` lists the organization's teams (`Team`: `id`, `name`,
 * `member`) — the ids `teamIds` and `teams` take, which no operation used
 * to answer. The three 1.16.0 read doors declare their idle `null` as a
 * nullable reference (`allOf` + `nullable`, never a keyword beside `$ref`),
 * and `ContactInput`/`ContactPatch.externalId` carry `nullable` on each
 * branch of their `oneOf`. `POST …/asks/{askId}` answers the documented
 * `EMPTY_ANSWER` for a blank answer. `KnowledgeEntry.source` is the enum
 * `chat` | `manual` | `api` (this door writes `api`); the superseded 409
 * names the topic's active row (`data.activeId`). A project `teamIds` that
 * repeats a team collapses (documents and skills already did), a no-op
 * audience leaves `updatedAt` alone, and an archived project refuses it
 * with `PROJECT_ARCHIVED`; a byte-identical agent `PUT` writes nothing.
 * `GET …/automations/{name}/runs` answers a deleted automation's kept runs.
 * A website `domain` that is a bare IP address is `WEBSITE_DOMAIN_INVALID`.
 * Products are documented as deleted outright (no trash, no restore).
 *
 * 1.20.0 — 2026-09-21: `PATCH /api/v1/projects/{id}/tasks/{taskId}`
 * (`setTaskArchived`) — the task's lifecycle toggle, `{ archived }`, the
 * one board verb the door lacked: a mirror that supersedes a task (a
 * re-delivery that opened a new one, a cancelled source record) retires
 * the old one instead of leaving it open. Idempotent both ways, write
 * access to an active project, the task itself may be archived (that is
 * what the restore is for), answers the task as it now stands.
 *
 * 1.21.0 — 2026-09-24: `POST /api/v1/conversations/assignment`
 * (`assignConversationTeam`) — queue a mirrored conversation to a team, or
 * clear it with `teamId: null`, named by `source` and `externalId` like
 * every mirror route. Admin and owner keys only. New code
 * `CONVERSATION_NOT_FOUND` (404) for a mirror no snapshot created.
 *
 * 2.0.0 — 2026-09-26: GitHub and GlitchTip intake no longer lets
 * `externalState` move Tale task status. New tasks enter backlog; existing
 * local progress stays authoritative. Other external systems keep the
 * mirrored close/reopen policy used by the generic desks. Task workflow
 * starts also refuse an active project-agent run with 409
 * `TASK_HAS_LIVE_RUN`; both engine families share one task start fence,
 * including concurrent requests under frozen snapshots. New task work
 * obeys the task-automation policy: 403 `TASK_AUTOMATION_DISABLED` or 409
 * `TASK_AUTOMATION_UNAVAILABLE`.
 *
 * 2.1.0 — 2026-09-27: `startedVia` (`schedule` | `webhook` | `event`) on
 * `RunSummary` and `Run` — which kind of trigger started a `trigger:<id>`
 * run, read off the run's own input so it stays true after the binding
 * changes kind; absent on a run a person or an API key started. A listing
 * could not tell a scheduled run from a webhook delivery before.
 * `DELETE /api/v1/products/{id}` answers 409 `LEGAL_HOLD_ACTIVE` under an
 * organization-wide legal hold or a custodian hold on the uploader of the
 * product's image, the way document and contact deletes do — the response
 * is now documented on the operation.
 *
 * 2.2.0 — 2026-09-27: new code `DATABASE_UNAVAILABLE` (503, with
 * `Retry-After` and a `requestId`) on every operation, the webhook doors
 * included, while the platform's database restarts or cannot be reached.
 * Such a request used to answer a 500 `INTERNAL_ERROR`, and a key the
 * database could not look up a 401 `UNAUTHORIZED` — a key that works once
 * the database is back. Retry with backoff.
 *
 * 3.0.0 — 2026-09-27: `HumanInputPart` (`type: "human-input"`) leaves the
 * `MessagePart` union, and with it the class a generated client made for
 * it. Chat never pauses a turn to ask the person a question, so no stored
 * or new message carries the part; a client drops a branch it could not
 * reach. Major because a named schema was removed.
 *
 * 3.1.0 — 2026-09-27: a schedule pauses itself after five runs in a row
 * fail for a reason the next occurrence would repeat (`node_error`,
 * `connector_error`, `llm_output_invalid`, `auth_error`, `missing_api_key`,
 * `credit_exhausted`, `model_not_found`): `enabled` turns false and
 * `lastSkipReason` — on `Trigger` and on `AutomationSummary.trigger` —
 * gains `paused_after_failures` until the trigger is saved again. `Trigger`
 * carries the streak: `consecutiveFailures`, and the last counted failure's
 * `lastFailedAt`, `lastFailureCode` and `lastFailedRunId`. Saving a trigger
 * resets the streak.
 *
 * 3.2.0 — 2026-09-28: 404 `ORG_SLUG_INVALID` and 403 `ORG_FORBIDDEN` carry
 * `data.organizations` — the slugs the key holder may send — the way 400
 * `ORG_SLUG_REQUIRED` already did, so a mistyped or foreign
 * `X-Organization-Slug` says what to send instead.
 *
 * 3.3.0 — 2026-09-28: `Task` carries its schedule and how it repeats, read
 * only: `startDate` and `dueDate` (epoch ms, present when set), `repeat` —
 * the new `TaskRepeat` rule (frequency, interval, anchors, `timezone`, and
 * `createOn: "dueDate"` when the next task is also created on the due date)
 * or null when the task does not repeat — and `repeatNextTaskId`, the task
 * that continues its series once one exists. An approved review (`POST
 * …/tasks/{taskId}/review`) that closes a repeating task continues its
 * series as a close in the app does.
 *
 * 3.4.0 — 2026-09-29: a skill says who created it and who last edited it.
 * `SkillSummary` and `Skill` carry `origin` — `release` for a skill a
 * managed configuration release installed, `builtin` when no owner is
 * recorded, `member` otherwise — and `ownerName`, the owner's display name
 * while they are a member of the organization. `updatedBy` and
 * `updatedByName` name the member whose write through Tale produced the
 * stored SKILL.md, read off the audit log; they are absent when nobody
 * edited the skill since it was created, or its file changed outside Tale
 * since. A `PUT /api/v1/skills/{slug}` that changes the document is
 * recorded in the audit log (`skill.created`, `skill.updated`,
 * `skill.sharing_changed`).
 *
 * 3.5.0 — 2026-09-29: an organization may reserve organization-wide
 * skills. Under its `skill_sharing` policy (Editors and above, or owners
 * and administrators, plus members granted the `tale:skills.publish`
 * capability), `PUT /api/v1/skills/{slug}` answers 403
 * `SKILL_PUBLISH_FORBIDDEN` to a key holder outside that set for a save that
 * would create a `visibility: org` skill, widen one to `org` or change an
 * `org` skill in place; `GET /api/v1/me` answers
 * `capabilities.skillPublish`.
 *
 * 3.6.0 — 2026-09-29: members create tasks and work their own. `POST
 * /api/v1/projects/{id}/tasks` creates a task for every key holder who can
 * read an active project, Members included, where it answered them 403
 * `RBAC_FORBIDDEN`. A change to one task — the intake's repeat, `PATCH
 * …/tasks/{taskId}`, `POST …/start`, and `POST …/review` for the key holder
 * and for the member it acts for — takes that task's work gate: an editor of
 * the project (the Editor role or higher), or the member who created the
 * task or is its person assignee; anyone else still gets 403
 * `RBAC_FORBIDDEN` (`ACTOR_FORBIDDEN` for the actor). The intake of a key
 * holder who is not the project's editor creates no label: a name the
 * project's catalog lacks answers the new 400 `TASK_LABEL_UNKNOWN`, nothing
 * written. Such a key holder also names, in the intake's `automationSlug`
 * and `runWorkflowSlug`, `…/start`'s and a review's `workflowSlug`, only an
 * automation built for tasks (its deployed version declares a task
 * contract) or the automation that owns the task: 403 `RBAC_FORBIDDEN`
 * otherwise.
 *
 * 3.7.0 — 2026-09-29: compatible model endpoints for personal API keys —
 * `POST /api/v1/openai/chat/completions` and `GET /api/v1/openai/models`
 * (OpenAI Chat Completions) and `POST /api/v1/anthropic/v1/messages`
 * (Anthropic Messages), streamed and not, with tools and images, relayed
 * through the platform's model gateway. Off until an organization turns them
 * on in its model access policy; owners, administrators and developers may
 * call them, any other member through the new `tale:models.api` capability.
 * Model access, credential allowlists, the input guardrails and the budget
 * caps apply; spend books under the person and the key. Bodies, answers and
 * refusals are the vendors' own shapes (`OpenAiError`, `AnthropicError`),
 * the stable code in `code`; new codes `MODEL_API_DISABLED`,
 * `MODEL_API_FORBIDDEN`, `MODEL_API_MODEL_FORBIDDEN`,
 * `MODEL_API_MODEL_UNKNOWN`, `MODEL_API_VISION_UNSUPPORTED`,
 * `MODEL_API_TOOLS_UNSUPPORTED`, `MODEL_API_VENDOR_TOOL_UNSUPPORTED`,
 * `MODEL_API_GUARDRAIL_BLOCKED`, `MODEL_API_GUARDRAIL_UNSUPPORTED`,
 * `MODEL_API_GUARDRAIL_UNAVAILABLE`, `MODEL_API_TEXT_TOO_LARGE`,
 * `MODEL_API_CONCURRENCY_EXCEEDED`, `MODEL_API_UNAVAILABLE` and
 * `MODEL_API_UPSTREAM_ERROR`. `GET /api/v1/me` answers
 * `capabilities.modelApi`.
 *
 * 3.8.0 — 2026-09-29: the project agent `tools` vocabulary gains
 * `task_start_agent` — an agent's live run puts another agent of the same
 * project to work on a task (assign, start, and a message the run addresses
 * first), answering to whoever that run answers to. Additive: agents saved
 * without it keep their grants.
 *
 * 3.9.0 — 2026-10-01: project agents answer `managed` — true for the
 * organization's standard agent, which Tale sets up in a project without
 * agents of its own under the new `standard_agent` governance policy and
 * keeps in line with it. Saving one answers 409 `PROJECT_AGENT_MANAGED`;
 * deleting it works as for any agent. A review relay that moves a task the
 * standard agent holds to `in_progress` can answer `STANDARD_AGENT_OFF`
 * (403) or `STANDARD_AGENT_UNAVAILABLE` (409). Additive.
 *
 * 3.10.0 — 2026-10-01: the project agent tools vocabulary gains
 * `task_update_metadata`, an explicit priority and agent-assignment grant
 * that starts no work. Existing agents keep their saved grants.
 *
 * 3.11.0 — 2026-10-02: the project-agent tools vocabulary gains
 * `task_review`, an explicit independent native review grant. TaskReview
 * reads carry a typed `reviewer`, the exact `implementationAgentId` and a
 * local `evidenceRevision`; `requestedFor` remains the nullable person
 * compatibility field. A relayed human approval of an agent-owned review
 * answers 409 `TASK_AGENT_REVIEW_REQUIRED` until an eligible person takes
 * it through an explicit handoff. No public agent-verdict endpoint is added.
 *
 * 3.12.0 — 2026-10-02: TaskReview reads add nullable
 * `agentReviewBlockedReason`, a current diagnosis for a captured agent review.
 * Source-less submissions and new human-policy reviews use the existing human
 * chain; existing captured ownership changes only through explicit handoff.
 *
 * 3.13.0 — 2026-10-02: native task_start_agent accepts tagged
 * resumeFrom:{kind:'review_repair',approvalId,runId} for one guarded repair
 * of a native changes-requested decision. Native task_get adds nullable
 * reviewDecision for the latest validated native receipt. No public REST
 * repair operation, grant change or automatic verdict dispatch is added.
 *
 * 3.14.0 — 2026-10-03: a run's `waitingFor` gains `room`, an agent step
 * whose start waits for sandbox room (its `detail` reads `room:<nodeId>`)
 * where it read `agent` before; no one to page. Additive.
 *
 * 3.15.0 — 2026-10-03: native task_get agentRuns includes explicit
 * retryPending, reusing the task card's native retry state without exposing
 * error text or provider reset times. No public REST endpoint is added.
 *
 * 3.16.0 — 2026-10-05: task `/status` reads a lifecycle activity revision,
 * verified member provenance and the accepted external projection receipt.
 * Custom sources opt into `/external-status` to project business decisions
 * they already validated, including completion and atomic archival. Exact
 * source binding, conditional native revision and monotonic source lifecycle
 * ordering protect concurrent native moves; no Tale approval is claimed and
 * captured native agent reviews remain protected. Additive.
 *
 * 3.17.0 — 2026-10-07: the project-agent tools vocabulary gains
 * `task_delegate_review`, an explicit grant to transfer a pending native
 * agent review with exact source and evidence preconditions. Native task_get
 * includes its bounded delegation receipt for reconciliation. Tale CLI can
 * manage an agent's tools through a conditional tools-only configuration
 * facet; saved models, instructions and secret grants remain independent.
 * No public REST delegation or agent-verdict endpoint is added. Additive.
 *
 * 3.18.0 — 2026-10-08: a run's `waitingFor` gains `in_doubt` — a write its
 * server was making when it stopped may already have happened, and a person
 * decides in the app how to continue (its `detail` reads
 * `in_doubt:<nodeId>`); `failureCode` gains `engine_incompatible` and
 * `effect_in_doubt`; runs carry `resumeCount`, `lastResume {reason:
 * shutdown | lease_expired, at}` and `stalled`. Additive.
 *
 * 3.19.0 — 2026-10-08: automation documents are analysed before they run,
 * and the MCP authoring tools say what the analysis found.
 * `validate_automation` answers `analysis` (the per-node summary and the
 * possible paths) and `types` (every value's inferred shape) beside its
 * issues; every issue carries `at` (a JSON pointer and a range in the
 * field), `params` (the facts its sentence names) and `related`
 * (the nodes it involves); `save_automation` answers the saved version's
 * `warnings`, and a refused save its `warnings` beside its `errors`;
 * `get_catalog` gives each capability its `outputSchema`. New warning
 * codes (MAYBE_NULL, UNCAUGHT_FAILURE, UNREACHABLE, TYPE_MISMATCH and the
 * rest of the analysis) and one more error (ITEM_WITHOUT_FOREACH, a
 * warning before). No REST operation changes. Additive.
 *
 * 3.20.0 — 2026-10-08: runs may be `quarantined` and carry
 * `legacyQuarantine`, a bounded description of legacy execution whose
 * external effects remain uncertain. Both run scopes expose
 * `POST …/runs/{runId}/legacy-quarantine`: an exact-observation stop
 * request with explicit acknowledgement, behind the existing developer
 * and project-write gates. The request does not clear the hold or prove
 * termination. Ordinary cancel refuses held runs (`RUN_QUARANTINED`);
 * stale stop requests answer `RUN_QUARANTINE_CHANGED`. Additive.
 *
 * 3.21.0 — 2026-10-08: API keys can belong to a member an Owner or Admin
 * made them for, or to a team, a project or the organization itself. Such a
 * key works in its one organization: it needs no `X-Organization-Slug`, and
 * one naming another organization answers 403 `ORG_FORBIDDEN`. A project's
 * key reaches its own project, the project list, `/me` and the model
 * endpoints; any other route answers 403 `API_KEY_SCOPE_FORBIDDEN`.
 * `GET /api/v1/me` answers `key.owner` (`kind`, `team`, `project`), lists
 * the bound organization alone, and an empty `user.email` for a key that
 * is not a person. Additive.
 *
 * 3.22.0 — 2026-10-08: budget rules can cap a project — everything spent in
 * it, whoever spends it, its own API keys included. A 429 `BUDGET_EXCEEDED`
 * names such a cap with `data.scope` `project`. Additive.
 *
 * 3.23.0 — 2026-10-09: the project-agent tools vocabulary gains
 * `knowledge_entry_write`, an explicit grant to save an organization-wide
 * knowledge entry by topic; changing an existing entry needs the version the
 * agent read, and a stale one is refused with the current text.
 * `KnowledgeEntry.source` gains `agent` for what such a grant wrote, its
 * `createdBy` naming the agent. Native `knowledge_entry_find` answers each
 * entry's version `id` and `updatedAt` and matches its content as well. No
 * REST operation changes. Additive.
 *
 * 3.24.0 — 2026-10-09: agents have mention handles, and mentions are stored
 * as whom they name. `ProjectAgent.handle` is the agent's handle, made from
 * its current name, unique in its project (`-02`, `-03` on a clash) and
 * made again on a rename, or when a member's email name or an automation's
 * store name comes to equal it. A comment body and a task description store each
 * mention a door resolves as a mention link,
 * `[@Ada Lovelace](mention:user/<userId>)`, and every read returns that
 * stored form: observable for a client that read the `@handle` it posted
 * back out of the text. Plain `@handle`, `@<id>` and the older name forms
 * still resolve when posted; a mention link naming nobody who can be
 * mentioned on the task is stored as plain text, and a task mirrored from
 * GitHub or GlitchTip keeps its `@names` as written. Comment reads carry
 * `bodyText` and task reads `descriptionText`, the same text with each
 * mention read as `@` and the current name, and so do the comment events
 * (`comment.bodyText`). A comment or a new task's description with a
 * mention answers 503 `MENTION_DIRECTORY_UNAVAILABLE` while who can be
 * mentioned cannot be read, where it answered 500 `INTERNAL_ERROR`.
 * Additive.
 *
 * 3.25.0 — 2026-10-09: an agent working other tasks is started all the
 * same, each run in an agent worker of its own. Native task_start_agent and
 * the automation step task.start_agent no longer answer `agent_busy` or
 * `busyTaskId`: such a start answers `started: true`, and a run that waits
 * for a free worker carries `waitingReason` (`org_limit`, `host`,
 * `destroy_pending` or `exec_limit`) and starts by itself. An agent that
 * names itself for another task is refused with `self_start`. Native
 * task_get agentRuns carry `waitingReason` while a run waits. No REST
 * operation changes.
 *
 * 3.26.0 — 2026-10-09: embeddings are counted and held to the budget caps.
 * A knowledge search answers 429 `BUDGET_EXCEEDED` (with `data` and
 * `Retry-After`) when a cap that binds the key holder, the key or the
 * searched project is reached; a document's indexing `errorCode` gains
 * `usage_limit` — a `failed` file whose indexing waits for such a cap and
 * resumes by itself. Additive.
 *
 * 3.27.0 — 2026-10-09: the MCP endpoint speaks protocol revision 2025-11-25
 * beside 2025-06-18 and 2025-03-26, answers an `MCP-Protocol-Version` it
 * does not speak with -32022 naming the `supported` revisions, answers
 * `initialize` with `instructions`, and reports this contract version as
 * `serverInfo.version`. Tool arguments that miss a tool's schema are a tool
 * result `INVALID_ARGUMENTS` listing every problem under `data.issues`
 * (`path`, `code`, `message`) where they were a -32602 naming the first; a
 * refusal a tool throws keeps its code, and an unexpected failure is
 * `INTERNAL_ERROR` with `data.requestId`. Read tools declare an
 * `outputSchema` and answer `structuredContent`; the text block is compact
 * JSON. Tools carry `_meta` hints (`anthropic/requiresUserInteraction` on
 * `deploy_automation` and `set_trigger`, `anthropic/maxResultSizeChars`).
 * Tools that execute an automation, and `answer_run_ask`, draw from the
 * `rest:execute` budget (`RATE_LIMITED`, `data.retryAfterMs`), and
 * `run_deployed`, a live `start_run`, `cancel_run` and `delete_trigger`
 * refuse a member before anything runs.
 * A request whose `Origin` the deployment does not accept is logged, and
 * refused with 403 `ORIGIN_FORBIDDEN` where the operator enforces the rule
 * (TALE_MCP_ORIGIN_ENFORCE); clients that send no `Origin` are not judged.
 * The MCP authoring tools reach the editor's parity: `save_automation` takes
 * `baseVersion` (a version saved since is refused, `AUTOMATION_VERSION_STALE`
 * with `data.latestVersion`), `create`, `projectId` and the version's
 * `settings`, `taskContract` and `presentation` (left out = kept from the
 * latest version, named in `carried`; null = none), answering `carried` and
 * `baseVersionChecked`; `get_automation` answers the whole version beside
 * `meta` and `automation` (`latestVersion`, `deployedVersion`, the three
 * fields, `createdVia`, `clientName`, `projectIds`, `trigger`); a version
 * records the door it was saved through (`createdVia`) and the client;
 * `test_automation` tests a saved version by `name` and records its verdict;
 * `deploy_automation` takes `expectedDeployedVersion`
 * (`AUTOMATION_DEPLOYMENT_STALE`) and answers `previousVersion`; `start_run`
 * takes `mode` — `live`, the default, or `mock`, any saved version and open
 * to every member; `list_runs` filters by `mode` and `statuses` (the REST
 * list's, `quarantined` included) and pages
 * with `cursor` / `nextCursor`; `list_versions` answers `createdVia`,
 * `clientName` and `deployments`. New tools: `delete_automation`,
 * `set_automation_projects`, `answer_run_ask` (each asking the person first,
 * like `deploy_automation` and `set_trigger`) and `get_automation_metrics`;
 * `get_run` names the question a run waiting on a person asked under
 * `run.ask` (`askId`, `question`, `nodeId`, `expiresAt`), which
 * `answer_run_ask` answers, and takes `detail` (`input`, `output`, `trace`,
 * `effects`; `[]` answers the status alone, for polling); `run_automation`
 * advertises only `mode: "mock"`, the one it ever ran here.
 * Member reads tighten on MCP and REST alike: an automation installed only in
 * projects the key holder cannot read is left out of `list_automations` and
 * `GET /api/v1/automations`, and its reads answer `AUTOMATION_NOT_FOUND`
 * (REST 404) — its runs by name too, unless runs of it are in the URL's
 * scope — and an MCP save onto it is refused as `AUTOMATION_NAME_TAKEN`.
 * Every change to an automation's definition is audited; one made through
 * the REST API is recorded as the key's (actor type `api`, `via: api-key`,
 * the key's id and the request id).
 * `validate_automation` takes `detail` (`[]` answers the issues alone), and
 * validation warns when a document names what the organization lacks:
 * SKILL_UNKNOWN, CONNECTOR_NOT_CONNECTED, SECRET_UNKNOWN (told only to
 * owners, admins and developers), HARNESS_UNKNOWN and EVENT_UNKNOWN, with
 * `params` and a closest name; a save's warnings carry them too. New
 * discovery tools list what a document may name: `list_models`,
 * `list_harnesses`, `list_skills`, `list_connectors`, `list_agent_secrets`
 * (names and masked previews for owners, admins and developers, an empty
 * list for anyone else), `list_projects` and `list_events`.
 * The endpoint serves resources and prompts: `resources/list` (the
 * references `tale://docs/{authoring,triggers,validation,skill}`, the node
 * kinds `tale://catalog/{kind}`, then every automation the key holder can
 * see, 100 a page with `nextCursor`), `resources/templates/list`
 * (`tale://automations/{name}`, `…/versions/{version}`, `tale://runs/{runId}`)
 * and `resources/read`, which reads exactly as the matching tool does and
 * answers a read that finds nothing with -32002 and the refusal's
 * `data.code`; `prompts/list` and `prompts/get` (`edit_automation`,
 * `debug_failed_run`, `add_trigger`, attaching what they are about).
 * `get_docs` takes `topic`; `get_catalog` narrowed to a core kind answers
 * the kind's `reference`. In a batch, a resource read or listing and a
 * prompt draw from the request budget like a tool call. The session route
 * `GET /api/app/mcp/skill` downloads the Tale skill (`SKILL.md`).
 * The endpoint also speaks MCP 2026-07-28, request by request beside the
 * 2025 revisions: a request whose `params._meta` names its revision (with
 * the client's capabilities and, optionally, its name) needs no
 * `initialize`; `server/discover` answers the revisions, capabilities and
 * instructions; its `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`
 * headers must say what its body says (else 400 -32020), a missing envelope
 * is 400 -32602, a revision it does not speak is 400 -32022 (now listing
 * 2026-07-28 too), a batch is refused (400 -32600), and `initialize`,
 * `ping` and unknown methods are 404 -32601; every result adds `resultType`
 * and the server under `_meta`, the lists, reads and `server/discover` add
 * `ttlMs` and `cacheScope: "private"`, and a read that finds nothing is
 * -32602 with the same `data`. The client a 2026-07-28 request names is
 * recorded with the call and on the versions and audit rows it writes.
 * No other REST operation changes. A script that matched the -32602
 * argument error, or read the indented text, reads the tool result instead.
 *
 * 3.28.0 — 2026-10-09: a schedule trigger runs on a repeat rule
 * (`repeat`, the `ScheduleRule` schema, from `startDate` in `timezone`) or
 * on a cron expression, and says what it does with occurrences it missed
 * (`catchUp`: `latest` or `skip`); every trigger kind takes a fixed `input`
 * that each run it starts receives under the trigger's own fields. The
 * `PUT …/triggers` body is the shared trigger contract, and a rule it
 * breaks answers `AUTOMATION_TRIGGER_INVALID` with each problem coded
 * under `data.issues`; its 200 adds `nextRunAt` and `warnings`
 * (`TRIGGER_INPUT_MISMATCH`, `TRIGGER_INPUT_NOT_TEMPLATED`). `Trigger`
 * reads `repeat`, `startDate`, `catchUp`, `input`, `nextRunAt` and
 * `lastSkipDetail`, and `lastSkipReason` gains `missed_occurrences`; the
 * listing's `trigger` adds `nextRunAt`. Newly refused, as fixes: a blank
 * `timezone` (it saved and never fired) and `cron` together with `repeat`.
 * The MCP `set_trigger` takes the same trigger as its `trigger` argument,
 * and `deploy_automation` answers the bound `trigger` (`kind`, `enabled`,
 * `nextRunAt`, `warnings`) beside `previousVersion`; the triggers reference
 * (`get_docs {topic: "triggers"}`) states repeat rules, catch-up and the
 * fixed input. Additive otherwise.
 *
 * 3.29.0 — 2026-10-09: a run reads step by step. `GET …/runs/{runId}/record`
 * answers the run's record (`RunRecord`): every step in the order it runs,
 * with its status, times, attempts, the decisions that ran or skipped it
 * (each condition explained with the values it read, `ExplainNode`), why it
 * produced no output followed back to the cause (`skip.chain`), why it
 * failed (`StepFailure`, a `reason` from a fixed list with its `params`),
 * glimpses of its values, the run's events a reader may see, the path it
 * took and, with `include=travels`, the data that travelled between steps;
 * `since` answers only what changed after a `cursor`. `…/record/node`
 * reads one step — or one of its items or passes — whole (`RunNode`: its
 * stored values with every cut and withheld place, where its templates'
 * text landed, what it read, how its output differs from its input, its
 * ledger call); `…/record/items` pages a step's items and passes
 * (`RunUnitPage`, keyset); `…/compare/{otherRunId}` compares two runs of
 * one automation (`RunDiff`). Each has its project twin and reads the run
 * as `GET …/runs/{runId}` does. New codes: `NODE_RUN_NOT_FOUND` (404) and
 * `RUN_COMPARE_MISMATCH` (400). A run's `effects` carry the `item` and
 * `pass` they were made for. A run runs again: `POST …/runs/{runId}/replay`
 * (`ReplayRequest`: `again`, `edited` with `input`, or `from` a step, a
 * `version` and a `mode`) answers 202 `ReplayStarted` and honours
 * `Idempotency-Key`; `GET …/replay` answers its `ReplayPlan` without
 * starting it. A fork reuses the steps the run finished outside the step
 * and what it feeds; the new run's `Run.replayOf` names the run it
 * replays. New codes: `REPLAY_RUN_NOT_FINISHED`, `REPLAY_NODE_UNKNOWN`,
 * `REPLAY_GRAPH_CHANGED`, `REPLAY_MODE_MISMATCH`,
 * `REPLAY_PROGRESS_UNREADABLE`, `REPLAY_INPUT_UNAVAILABLE`. The MCP
 * `get_run` takes `include` (`["record"]`, `["travels"]`) and answers
 * `record` beside `run`; new read tools `get_run_node` and `compare_runs`
 * answer the same unit and comparison, and `replay_run` runs a run again
 * (`dryRun` answers the plan). Additive otherwise.
 *
 * 3.30.0 — 2026-10-10: the MCP endpoint reads, plans and changes the
 * organization's settings, in a new `settings` group. `get_settings`
 * answers, without `kinds`, the catalog of setting kinds (what each is, its
 * `ops` and `acts`, `baseRisk`, the Settings pages it covers, whether this
 * deployment serves it and what the caller's role may do) and, with
 * `kinds`, each resource the caller may read with its `key`, `config` and
 * native `hash`, a secret reading as `{masked: true, preview}`.
 * `plan_settings` answers each change's `action`, `currentHash`, `diff`,
 * `effects` and `risk`, or its `refusal`, and writes nothing.
 * `apply_settings` is compare-and-set: `expected` names every changed
 * resource's hash (null for one it creates); a refused change or a resource
 * that moved applies nothing (`SETTINGS_STALE` with `data.currentHash`);
 * changes run in a fixed order across kinds and the first failure stops the
 * rest, the answer naming what was `applied`, what `failed` and what was
 * `skipped`. It asks the person before every call and draws from a new
 * `rest:settings` budget (30 a minute, 60 at once). No argument may carry a
 * secret (`SECRET_ARGUMENT_REFUSED`); further codes `SETTINGS_KIND_UNAVAILABLE`,
 * `SETTINGS_NOT_FOUND` and `SETTINGS_DUPLICATE`. The kinds served are the
 * organization's own providers and their environment credentials, its
 * policies, embedding model and branding, the deployment's settings, and a
 * project's instructions, its agents' instructions, tools and model, and a
 * task's description and review context, each through the writer its
 * Settings page uses.
 * `get_docs` takes the topic `settings` (also `tale://docs/settings`): every
 * kind with its config's fields, the effects of a plan and every refusal.
 * The server instructions and the Tale skill name the settings loop. No
 * REST operation changes.
 *
 * 3.31.0 — 2026-10-10: two connector node types call any HTTPS API from the
 * new `http` connector: `http.get` reads and `http.send` writes, behind
 * approval like every write. A credential of the connector holds the API's
 * base URL and signs the request; a step without one reaches public HTTPS
 * hosts only. A connector step's `credential` now names the stored
 * credential it acts as (it was accepted and ignored), and a connector whose
 * credential is optional runs a step that names none without any.
 * `StepFailure.reason` gains the HTTP connector's causes: `HTTP_STATUS`,
 * `HTTP_TIMEOUT`, `HTTP_UNREACHABLE`, `HTTP_BLOCKED_HOST`, `HTTP_OFF_ORIGIN`,
 * `HTTP_URL_INVALID`, `HTTP_HEADER_RESERVED`, `HTTP_TOO_LARGE`,
 * `HTTP_NOT_JSON` and `HTTP_RATE_LIMITED`. Validation answers four more
 * codes: `HTTP_URL_NOT_HTTPS` (a warning), `HTTP_SECRET_IN_URL` and
 * `HTTP_HEADER_RESERVED` (errors) for an HTTP step's written-out address and
 * headers, and `CREDENTIAL_UNKNOWN` (a warning) for a connector step that
 * names a credential its connector does not hold in service. The rate-limit
 * catalog gains `automation:http`, 120 calls a minute per organization.
 *
 * 3.32.0 — 2026-10-10: a `knowledge.search` connector node type searches the
 * organization's knowledge from an automation and returns ranked passages,
 * reading what the run may read (its project's documents, its automation's
 * bound projects', or the hub's) and spending under the run's subject.
 * `StepFailure.reason` gains `KNOWLEDGE_NOT_CONFIGURED` and
 * `KNOWLEDGE_UNAVAILABLE`, and `BUDGET_EXCEEDED` for a step a usage limit
 * refused — an `llm` step's refusal, which read `UNKNOWN`, now says so. A
 * step of a platform connector (`task`, `document`, `conversation`,
 * `sandbox`, `knowledge`) takes no `credential`, which it ignored:
 * validation answers `NODE_UNKNOWN_FIELD` for one.
 *
 * 3.33.0 — 2026-10-10: `Run.failureCode` gains `connector_unavailable`, for a
 * connector whose service did not answer, answered too slowly, was busy or
 * failed on its own side (a 429 or a 5xx): it neither counts toward a
 * schedule's pause nor resets the count, where `connector_error` counted. A
 * live connector failure that names no cause is now classified by the
 * status the service answered (`CONNECTOR_AUTH`, `CONNECTOR_NOT_FOUND`,
 * `CONNECTOR_RATE_LIMITED`, `CONNECTOR_UNREACHABLE`, `CONNECTOR_FAILED`),
 * as a test run's always was; it read `UNKNOWN`.
 *
 * 3.34.0 — 2026-10-10: a `task.create` connector node type creates a task in
 * a project its automation is installed in — title, description, assignee
 * (a member's email or user id, or an agent of the project), status, due
 * date and labels — one per execution of the step, naming the automation as
 * its creator. `StepFailure.reason` gains `TASK_PROJECT_NOT_BOUND` and
 * `TASK_ASSIGNEE_UNKNOWN`.
 *
 * 3.35.0 — 2026-10-11: a `notify.member` connector node type tells members of
 * the organization something from an automation — a title, words and a link
 * (a page of the organization or an https address), in their notifications
 * and by email — and answers who got it and who was skipped.
 * `StepFailure.reason` gains `NOTIFY_NOT_A_MEMBER` and `NOTIFY_RUN_LIMIT`.
 *
 * 3.36.0 — 2026-10-11: a chat reply can carry the files its assistant made —
 * a document, a spreadsheet, a chart, an image: `MessagePart` gains
 * `ArtifactPart` (`fileId`, `name`, `mediaType`, `sizeBytes`, `callId`),
 * after the tool result that produced the file.
 *
 * 3.37.0 — 2026-10-12: over MCP, `list_versions` answers a page of an
 * automation's version history (`limit`, `before`, `nextBefore`,
 * `latestVersion`) and, for each version, the door and client it came
 * through, what it was based on and restored from, what it changed, how its
 * tests went and when it last went live; `get_automation` takes `against`
 * (and `diffFormat`) and answers what the version it reads changed against
 * another as `diff`; `save_automation` takes `name` and `restoreVersion`
 * instead of a document to bring an older version back as the newest; and
 * `deploy_automation` answers `kind`: `rollback` for a deploy of an older
 * version, `deploy` for any other.
 *
 * 3.38.0 — 2026-10-12: versions on the REST API, as the app and MCP read
 * them. `GET /automations/{name}/versions` answers each version's `createdVia`,
 * `viaInferred`, `clientName`, `createdByName` (a member's name, never an
 * e-mail address), `basedOnVersion`, `restoredFromVersion`, `changes`, `tests`
 * and `lastDeployedAt`, `latestVersion` beside the list, and pages with `limit`
 * and a signed `cursor` (`isDone`, `continueCursor`; without `limit`, the whole
 * history in one page as before). New: `GET /automations/{name}/deployments`
 * (when each version went live, and what is live now),
 * `GET /automations/{name}/compare` (what a version changed against another,
 * node by node or as a unified patch over the YAML),
 * `POST /automations/{name}/deployments` (put a saved version live behind the
 * deploy gate, `expectedDeployedVersion` refusing a deploy another one
 * overtook; an older version rolls back; the developer capability) and
 * `POST /automations/{name}/versions/{version}/restore` (bring an older
 * version back as the newest; never a deploy; the developer capability). The
 * error codes `AUTOMATION_DEPLOYMENT_STALE`, `AUTOMATION_DEPLOY_REJECTED`,
 * `AUTOMATION_INVALID`, `AUTOMATION_TESTS_FAILING` and
 * `AUTOMATION_VERSION_STALE` join the registry. A deploy answered over MCP
 * now says `kind: "unchanged"` for a version that was live already.
 *
 * 3.39.0 — 2026-10-12: over MCP, `test_automation` takes `tests` (run only
 * the tests named, by the name the document gives each) and `detail`
 * (`output`, `effects`, `trace`: what each test's run returned, did and went
 * through), answers `recorded` when the whole suite of a saved version left
 * its verdict on it, and leaves out a run too large for the answer
 * (`detailOmitted`); `run_automation` takes `mocks`, `failures`, `upTo`,
 * `only` and `item` — stand-ins for nodes and a narrower scope, as a test
 * and the app's step test give them — and answers `focus` and `unusedMocks`.
 * Both run in the API process, so they draw from the organization's budget
 * for runs that are never stored, one execution per run or per test: a spent
 * budget, or a server with every place taken, answers `RATE_LIMITED` with
 * `data.retryAfterMs`. The refusal code `BENCH_INVALID` (`data.issue` is the
 * engine's own) joins the MCP vocabulary.
 *
 * 3.40.0 — 2026-10-12: a saved version's tests on the REST API, as the app
 * and MCP run them. `POST /automations/{name}/versions/{version}/tests` runs
 * the tests in the version's document on the mocks — all of them, or those
 * named in `tests` — and answers the report (`passed`, `failed`, one result
 * for each test with its typed `failures`, `notRun`); `detail` (`output`,
 * `effects`, `trace`) adds what each run returned, did and went through. The
 * whole suite, run to its end, is recorded on the version as its verdict, made
 * by hand with the key (`recorded`). It draws one execution from the key
 * holder and one unit for each test from the organization's budget for runs
 * that are never stored (`RATE_LIMITED`, `Retry-After`); any member's key may
 * run them. `GET /automations/{name}/versions/{version}/tests` reads the
 * version's latest check: the verdict, when, which act made it and who, and
 * the report. No error code joins the registry.
 *
 * 3.41.0 — 2026-10-12: over MCP, `get_settings` answers the cursor of each
 * kind that has another page under `cursors`, by kind; `nextCursor` stays
 * for a read of one kind and is null for several, where it named only the
 * last kind's page. A cursor names the kind that issued it and reads only
 * that kind (`INVALID_CURSOR` otherwise). The project and agent listings end
 * a page once the configurations it read would crowd the answer (about
 * 200,000 characters), the agents paged over their (project, agent) pairs.
 * A change to a subscription credential answers `USE_SUBSCRIPTION_FLOW`,
 * where it answered `SETTINGS_TALE_ONLY`; a provider Tale ships answers as
 * no setting (`SETTINGS_NOT_FOUND`), where it read as a refused name; and an
 * `expected` that names resources no change names lists at most fifty of
 * them. No REST operation changes.
 *
 * 3.42.0 — 2026-10-12: over MCP, the settings kind `automation-approval`
 * reads and changes the writes an automation may make without a person
 * approving each run, as its General tab does. `get_settings` answers, for
 * each automation, the writes `allowed`, the ones its latest version `used`,
 * those a rule of the approval policy still requires a person for
 * (`requiredByPolicy`) and who allowed each (`grants`, by name, never by
 * address); the acts `grant` and `revoke` with `args.types` change it for an
 * owner's or admin's key, and a developer's key reads it. A plan of a `grant`
 * names the effect `removes-human-approval`; the hash covers the automation
 * and the writes allowed alone. An act that would change nothing plans and
 * applies as `unchanged`. The refusal code `APPROVAL_ALLOWANCE_INVALID` joins
 * the settings vocabulary. No REST operation changes.
 *
 * 3.43.0 — 2026-10-13: the MCP endpoint takes a coding agent's access token
 * in place of an API key where the operator lets agents sign in (off unless
 * set). Its 401 then carries the challenge RFC 9728 describes —
 * `resource_metadata` and `scope` — and a credential that was presented and
 * refused adds `error="invalid_token"`. A token opens the MCP endpoint
 * alone; on every other route it is read as an API key. A call made through a
 * connection acts in the organization the connection was made for (naming
 * another in `X-Organization-Slug` answers 403 `ORG_MISMATCH`) and holds the
 * access its person allowed: a request that calls a tool needing access the
 * connection lacks is refused whole with 403 `INSUFFICIENT_SCOPE` and the
 * challenge `error="insufficient_scope"`, which names what to ask for, and
 * a call that the person's role could never be given the access for answers
 * the same code as a tool error. `tools/list` is unchanged. The codes
 * `INSUFFICIENT_SCOPE` and `ORG_MISMATCH` join the registry. No REST
 * operation changes.
 *
 * 3.44.0 — 2026-10-13: coding agents may sign in to the MCP endpoint
 * unless the operator turns it off (`TALE_MCP_CLIENT_METADATA_DOCUMENTS` and
 * `TALE_MCP_DYNAMIC_CLIENT_REGISTRATION` now default to on): the discovery
 * documents answer on a default deployment — the endpoint's protected-resource
 * metadata at `/.well-known/oauth-protected-resource`, and the sign-in
 * server's own with the agent scopes, `refresh_token`, the metadata-document
 * flag and, for a client that registers itself, a `registration_endpoint` —
 * and the 401 of `/api/v1/mcp` carries the challenge 3.43.0 describes.
 * `agentOAuth` joins the security schemes (OAuth 2.1 authorization code with
 * PKCE, the seven scopes) and the endpoint's security lists it beside the API
 * key. No operation, schema or API key behaviour changes.
 *
 * 3.45.0 — 2026-10-14: the settings tools take a project's dispatch
 * (`project-dispatch`, id `<projectId>`): its pool of agents, how many runs it
 * holds, which columns count as ready work, how carefully the sandbox host
 * admits a start, and its standing roles started on a schedule. A project
 * without one reads as null; a change may create it. A start the dispatch
 * makes answers to the project (`startedBy` `dispatch:<projectId>`) and runs
 * with trigger `dispatch`. A run waiting for its model reads `waitingReason`
 * `model_capacity`. A dispatch may declare `gates`, signals from outside that
 * hold the ready work they govern: `POST /api/v1/projects/{id}/dispatch/gates/{key}`
 * reports a state or a value (`DISPATCH_GATE_UNKNOWN`,
 * `DISPATCH_GATE_VALUE_UNJUDGED`), and `GET /api/v1/projects/{id}/dispatch`
 * reads what the dispatch does and why each agent of its pool is idle.
 * The governance policy `sandbox_workspaces` takes `reclaimOnDiskPressure`,
 * `maxWorkspaceGiB` and `reclaimMinIdleHours` (a file without them reads
 * their defaults), and a plan that sets or tightens the size cap names the
 * effect `irreversible`.
 *
 * 3.46.0 — 2026-10-15: a project's dispatch may hold up to 500 runs at once
 * (`maxConcurrentRuns`, up to 100 before) and keep one agent of its pool on
 * up to 500 of them (`perAgentConcurrency`, up to 5 before): as many as an
 * organization may have agent workers. A write whose `perAgentConcurrency`
 * is above its `maxConcurrentRuns` is refused; a dispatch stored before
 * still reads as it was stored. `GET /api/v1/projects/{id}/dispatch` answers
 * `runCounts` for each agent of the pool — every run it holds, `running`,
 * `queued`, and `waiting` by reason — and lists its 50 oldest runs at most
 * under `runs`, where it listed every one.
 *
 * 3.47.0 — 2026-10-15: the issue sync reads two more trackers, and the task
 * intake treats their tasks as it treats GitHub's and GlitchTip's: for
 * `externalSystem` `github-security` (a GitHub repository's security alerts)
 * and `forgejo` (a Forgejo instance's issues and pull requests),
 * `externalState` no longer moves the task (new tasks enter `backlog`, local
 * progress stays), a description keeps that tracker's `@names` as written,
 * and `PUT …/tasks/{taskId}/external-status` refuses the task
 * (`TASK_EXTERNAL_REF_INVALID`). Before, a task under either name was a
 * custom source whose `closed` parked it at `in_review`. No operation or
 * schema changes.
 *
 * 3.48.0 — 2026-10-15: a project's dispatch may serve other boards of its
 * organization (`sources`, up to 20, each `{projectId, statuses?, labels?}`,
 * never its own project) and name the agents that review its pool's work
 * (`reviewers`, up to 10 agents of the project granted task review). Adding
 * or changing a source needs the right to edit that project
 * (`DISPATCH_INVALID` names it under `sources.<n>.projectId`); a source kept
 * exactly as stored is not checked again, and a save that only switches the
 * dispatch off is never refused for what it names. Every pass judges a
 * source again, on the right of whoever saved the dispatch last, and skips
 * one that is gone, archived, or whose right that person lost; the settings
 * tools then read the unchanged dispatch as not yet applied for a caller
 * whose save would serve such a board again.
 * While a dispatch reaches a source, its pool, standing-role agents and
 * reviewers may be assigned to, started on and work that board's tasks:
 * `task_find` lists those projects too, and `task_get`, `task_comment`,
 * `task_update_status`, `task_update_metadata`, `task_review` and
 * `task_delegate_review` take their tasks. A run a person or key started
 * reaches only the boards its starter may edit, and on a board another
 * project's dispatch serves it is confined to its task unless its starter
 * may edit both projects; a run the dispatch started reaches every board it
 * serves. `GET /api/v1/projects/{id}/dispatch`
 * answers `sources` (each reachable or `skipped` with why), `reviewers`,
 * `servedBy` (the dispatches that serve this project) and, on every listed
 * run, the `projectId` of the board its task is on; an agent's run counts
 * span every board. Another project is named only to a caller who may read
 * it: a run on a board the caller may not read is counted in `runCounts`
 * and not listed, and such a source or serving dispatch answers `name:
 * null`. A dispatch without the two new fields reads, hashes and behaves as
 * before.
 *
 * 3.49.0 — 2026-10-15: a project agent carries its own repository access.
 * `ProjectAgent` answers `connectorCredentials` (a connector slug to the
 * name of the organization credential the agent acts as; `{}` when it pins
 * none) and `gitIdentity` (`{name, email}` its commits carry, or `null`),
 * and `POST`/`PUT /api/v1/projects/{id}/agents…` take both. A pin must name
 * a credential the organization holds for that connector (400
 * `PROJECT_AGENT_CREDENTIAL_UNKNOWN`, the pins under
 * `data.connectorCredentials`), and only an organization admin may change
 * the pins (403 `PROJECT_AGENT_CREDENTIALS_FORBIDDEN`). Only a connector
 * that opens a git host — GitHub, Forgejo — takes a pin; one on any other
 * connector is refused with the same 400. A `PUT` that omits either field
 * keeps what is stored — unlike the other optional fields, since dropping a
 * pin would widen the agent to the connector's default — and `{}` / `null`
 * clear them. An equipped pinned connector hands the agent's sandbox the
 * pinned credential's git access instead of the default's, and the agent's
 * connector calls through the sandbox bridge act as it too; a pin whose
 * credential is gone hands it nothing and fails those calls. The MCP
 * `list_connectors` tool names that host as `gitHost`.
 */
export const API_CONTRACT_VERSION = '3.49.0';
