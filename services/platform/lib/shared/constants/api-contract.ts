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
 */
export const API_CONTRACT_VERSION = '1.14.0';
