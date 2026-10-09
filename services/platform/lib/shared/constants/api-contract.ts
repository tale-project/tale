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
 * 3.25.0 — 2026-10-09: a schedule trigger runs on a repeat rule
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
 * Additive otherwise.
 */
export const API_CONTRACT_VERSION = '3.25.0';
