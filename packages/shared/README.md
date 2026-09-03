# @tale/shared

Dependency-light TypeScript infrastructure shared across Tale's Node-side code:
the platform backend, the CLI, and the standalone RAG/crawler services.
Cross-cutting plumbing only — config readers, a DB-retry wrapper, a logger,
error types, and small utilities. No domain logic.

Source-only package: consumers import directly from `@tale/shared/<subpath>`.
There is no build step.

```ts
import { createLogger } from '@tale/shared/logging/logger';

const log = createLogger({ namespace: 'rag' });
log.info('ready');
```

## What it provides

Every subpath below is declared in `package.json` `exports`.

### Config

- **`@tale/shared/config/providers`** — file-based LLM provider reader. Each org
  owns its own catalog at `<TALE_CONFIG_DIR>/<orgSlug>/providers/*.json` (plus
  optional SOPS-encrypted `*.secrets.json`). `loadProviders(orgSlug)` returns the
  parsed `ProviderConfig[]`; `getChatModel`/`getEmbeddingModel`/`getVisionModel`
  resolve the org's default model for a tag and return the effective
  `{ baseUrl, apiKey, modelId }` (embedding also carries `dimensions`). API keys
  resolve model-env → provider-env → file, with the reserved
  `TALE_PROVIDER_KEY_` prefix enforced.
- **`@tale/shared/config/base`** — `baseServiceSettingsSchema` (a Zod object that
  services `.extend(...)`) plus `parseEnv(schema, env?, prefix?)` to map
  `process.env` (with optional prefix stripping, e.g. `RAG_`) onto fields.
  `getAllowedOriginsList` parses the CORS setting; `getChatConfig` /
  `getEmbeddingConfig` / `getVisionConfig` and the `get*ModelId` /
  `getEmbeddingDimensions` accessors wrap the provider reader per org slug.
- **`@tale/shared/config/org-slug`** — `ORG_SLUG_RE`, `validateOrgSlug(slug)`,
  and `InvalidOrgSlugError`. Single source of truth for legal org slugs, guarding
  filesystem path joins against traversal and shell metacharacters.

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
- **`@tale/shared/logging/setup`** — `configureLogging({ level?, namespace? })`
  builds a logger with case-insensitive level normalization, and
  `shouldLogAccess(message)` is the `GET /health` access-log suppression
  predicate.

### Errors

- **`@tale/shared/errors`** — base error classes: `TaleError` and its subclasses
  `ConfigError` and `ExtractionError`.

### Utils

- **`@tale/shared/utils/hashing`** — SHA-256 helpers for dedup:
  `computeFileHash(path)` (streaming) and `computeContentHash(string | Uint8Array)`.
- **`@tale/shared/utils/model-list`** — parse comma-separated model env vars:
  `parseModelList`, `getFirstModel`, `getFirstModelOrThrow`.
- **`@tale/shared/utils/sops`** — `decryptSecretsFile(path)` reads a provider
  secrets file: decrypts SOPS-encrypted JSON via the `sops` CLI (needs
  `SOPS_AGE_KEY` / `SOPS_AGE_KEY_FILE`) or returns plaintext JSON as-is, caching
  by mtime. Also exports `invalidateSecretsCache` and
  `EncryptedFileWithoutKeyError`.

## Development

```bash
bun run --filter @tale/shared typecheck   # tsc --noEmit
bun run --filter @tale/shared lint         # oxlint --type-aware
bun run --filter @tale/shared test         # vitest run
```

Tests live next to their modules as `*.test.ts` (e.g.
`src/db/retry.test.ts`, `src/config/providers.test.ts`,
`src/utils/hashing.test.ts`, `src/utils/model-list.test.ts`).
