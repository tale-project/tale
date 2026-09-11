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
- **`@tale/shared/schemas/{automation-pack,automation-settings,task-contract}`**
  — automation package declarations and limits, operator settings forms and task
  bindings. Catalog reads, ZIP decoding and engine validation stay in the platform.
- **`@tale/shared/net/private-ip`** and **`@tale/shared/utils/{session-idle,model-ref,project-key}`**
  — pure validation helpers used by those contracts and their consumers.

Schemas never import from a service or tool workspace. The boundary guard walks
all schema exports and their local dependencies; colocated tests preserve the
same accepted values, defaults and refusal cases as the platform contracts.

### Database

- **`@tale/shared/db/retry`** — retry wrappers over `postgres.js` with exponential
  backoff. `withRetry(operation, opts?)` reruns the whole operation on transient
  connection faults; `transactWithRetry(sql, callback, opts?)` does the same
  around `sql.begin`. `isTransientDbError` classifies SQLSTATE/Node socket error
  codes and timeout messages.

### Logging

- **`@tale/shared/logging/logger`** — `createLogger(opts?)`: a `console`-backed,
  level-gated logger (`debug` < `info` < `warn` < `error`) with optional
  namespace tag, `pretty` colored TTY output, `child(namespace)`, and a
  `debugEnvVar` escape hatch. Also exports `LogLevel`, `Logger`, `ansi`, and
  `timestamp()`.

### Utils

- **`@tale/shared/utils/hashing`** — SHA-256 helpers for dedup:
  `computeFileHash(path)` (streaming) and `computeContentHash(string | Uint8Array)`.
- **`@tale/shared/utils/model-list`** — parse comma-separated model env vars:
  `parseModelList`, `getFirstModel`, `getFirstModelOrThrow`.

## Development

```bash
bun run --filter @tale/shared typecheck   # tsc --noEmit
bun run --filter @tale/shared lint         # oxlint --type-aware
bun run --filter @tale/shared test         # vitest run
```

Tests live next to their modules as `*.test.ts` (e.g.
`src/db/retry.test.ts`, `src/utils/hashing.test.ts`,
`src/utils/model-list.test.ts`).
