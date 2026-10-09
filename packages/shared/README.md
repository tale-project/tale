# @tale/shared

TypeScript contracts and infrastructure shared by the Tale platform and CLI.
The schemas and their pure helpers work in the browser and server; database,
process and terminal modules have separate explicit subpaths. Native settings
I/O, permissions and side effects remain in the platform backend.

Source-only package: consumers import directly from `@tale/shared/<subpath>`.
There is no build step.

```ts
import { createLogger } from '@tale/shared/logging/logger';

const log = createLogger({ namespace: 'rag' });
log.info('ready');
```

## What it provides

Every subpath below is declared in `package.json` `exports`.

### Configuration contracts

- **`@tale/shared/schemas/<name>`** — the native Zod schemas for governance,
  branding, deployment, knowledge, providers, connectors, skills, agents and
  projects. Platform forms/APIs and CLI validation import these same objects.
- **`@tale/shared/schemas/configuration`** — opaque native configuration hash
  preconditions. A null hash means an absent resource.
- **`@tale/shared/config/platform-resources`** — the native platform resource
  model that `tale config platform`, managed deployments and the MCP settings
  tools share: `platformResourceSchema` (one entry per declarable kind), each
  resource's identity (`resourceId`), a declaration's cross-resource rules
  (`platformConfigurationSchema`) and when stored state already is what was
  asked for (`resourceConverged`). Server-only: it compares
  `configurationHash` digests, so it sits outside the browser-safe `schemas/`.
- **`@tale/shared/schemas/{automation-pack,automation-settings,task-contract}`**
  — automation package declarations and limits, operator settings forms and task
  bindings. Catalog reads, ZIP decoding and engine validation stay in the platform.
- **`@tale/shared/schemas/epoch-ms`** — the one timestamp bound: `epochMsSchema`
  takes whole epoch milliseconds from 0 to `EPOCH_MS_MAX`, the latest instant a
  JavaScript `Date` holds; `isEpochMs` is the same test for readers of stored rows.
- **`@tale/shared/schemas/schedule-rule`** — a schedule trigger's repeat rule:
  `scheduleRuleSchema` (every N minutes or hours, optionally only on some weekdays
  and hours, or times of day on a daily, weekly, monthly or yearly rule), the
  refusal codes it answers (`scheduleIssueCode`), `normalizeScheduleRule` and
  `sameScheduleRule`, the `"HH:MM"` time helpers and the wall-clock grid arithmetic.
- **`@tale/shared/net/private-ip`** and **`@tale/shared/utils/{session-idle,model-ref,project-key}`**
  — pure validation helpers used by those contracts and their consumers.

Schemas never import from a service or tool workspace. The boundary guard walks
all schema exports and their local dependencies; colocated tests preserve the
same accepted values, defaults and refusal cases as the platform contracts.

### Database

- **`@tale/shared/db/retry`** — retry wrappers over `postgres.js` with exponential
  backoff. `withRetry(operation, opts?)` reruns the whole operation, such as a
  `sql.begin` transaction, on transient connection faults. `isTransientDbError`
  classifies SQLSTATE/Node socket error codes and timeout messages.

- **`@tale/shared/db/serializable`** — transaction support for serializable operations.
  Keep callbacks safe to retry; external effects belong outside a retried transaction.

### Server and CLI helpers

| Import                                       | Responsibility                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@tale/shared/http/entity-tag`               | HTTP entity tags and conditional request helpers                                                   |
| `@tale/shared/http/range`                    | Byte-range parsing for file responses                                                              |
| `@tale/shared/process`                       | Split subprocess output into lines, keep recent lines in a `RingBuffer`, open a URL with `openUrl` |
| `@tale/shared/terminal` and `/terminal/live` | Terminal rendering and live output                                                                 |
| `@tale/shared/classify`                      | Classify command output                                                                            |
| `@tale/shared/tux`                           | Terminal user experience helpers                                                                   |
| `@tale/shared/utils/site-urls`               | Resolve public site URLs                                                                           |

Check a module's imports before using it in browser code. Explicit subpaths keep Node/Bun-only
process and terminal dependencies out of frontend bundles.

### Logging

- **`@tale/shared/logging/logger`** — `createLogger(opts?)`: a `console`-backed,
  level-gated logger (`debug` < `info` < `warn` < `error`) with optional
  namespace tag, `pretty` colored TTY output, `child(namespace)`, and a
  `debugEnvVar` escape hatch. Also exports `LogLevel`, `Logger`, and
  `timestamp()`.

### Utils

- **`@tale/shared/utils/hashing`** — `computeContentHash(string | Uint8Array)`, the SHA-256
  hex digest the knowledge index dedups content by.
- **`@tale/shared/utils/stable-stringify`** — `stableStringify(value)`, JSON with every
  object's keys sorted (a value JSON cannot hold reads as `null`). Pure: the automation
  engine and the browser compare values with it.
- **`@tale/shared/utils/configuration-hash`** — `configurationHash(value)`, the SHA-256 of
  that key-sorted JSON: a native configuration resource's `hash`, and the `expectedHash`
  a write takes back. Server-only (Node's crypto); a golden corpus pins every digest.

## Development

```bash
bun run --filter @tale/shared typecheck   # tsc --noEmit
bun run --filter @tale/shared lint         # oxlint --type-aware
bun run --filter @tale/shared test         # vitest run
```

Tests live next to their modules as `*.test.ts` (e.g.
`src/db/retry.test.ts`, `src/utils/hashing.test.ts`).
