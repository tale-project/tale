# @tale/shared

Dependency-light TypeScript infrastructure shared across Tale's Node-side code:
the platform backend and the CLI. Cross-cutting plumbing only — a DB-retry
wrapper, a logger, terminal output, and small utilities. No domain logic.

Source-only package: consumers import directly from `@tale/shared/<subpath>`.
There is no build step.

```ts
import { createLogger } from '@tale/shared/logging/logger';

const log = createLogger({ namespace: 'rag' });
log.info('ready');
```

## What it provides

Every subpath below is declared in `package.json` `exports`.

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
