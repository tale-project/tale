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
 */
export const API_CONTRACT_VERSION = '1.9.0';
