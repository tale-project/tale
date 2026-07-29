# lib/mocks

OpenAPI-driven mock gateway for **every third-party API the platform calls** —
the OpenAI-compatible AI provider endpoints and all the connectors
(Slack, GitHub, Confluence, Discord, Microsoft Graph, Gmail, Google Drive,
Twilio, Tavily, Shopify). One Bun process serves them all, offline and
deterministically, so the Playwright e2e suite, manual QA, and the
spec-conformance contract tests never touch a live API.

## How it works

```
                         ┌─────────────────────────────────────────┐
  provider baseUrl ─────▶│  GET  /health                           │
  (e2e-mock.json)        │  POST /v1/chat/completions  → override   │  ← SSE + scenarios
                         │  …/v1/*                     → Prism      │  ← embeddings/images/audio
  connector calls ──────▶│  …/mock/<connector>/*     → Prism      │  ← one instance per spec
  (rewritten, see below) └─────────────────────────────────────────┘
```

- **Specs** live in [`specs/`](./specs) — trimmed OpenAPI 3.1 docs covering only the
  operations our connectors/providers actually call. Each response carries one
  canonical `example`; with Prism's `mock.dynamic = false` that example is
  returned byte-for-byte every time (the determinism the assertions rely on).
- **`src/gateway.ts`** builds one [Prism](https://github.com/stoplightio/prism)
  instance per spec (`src/prism-instance.ts`) and mounts it at the spec's
  `mountPrefix` (`src/registry.ts`). The prefix is stripped before Prism matches
  an operation, so spec paths mirror the real upstream (`/repos/{owner}/{repo}`,
  `/api/conversations.list`, …).
- **The one exception** is `POST /v1/chat/completions`: Prism can neither stream
  Server-Sent Events nor branch a body on the request's _content_, so the chat
  route is owned by `src/overrides/chat-completions.ts` with its deterministic content in
  `src/overrides/canned.ts`. Everything else is pure-spec Prism.

## Running it

```bash
bun --filter "lib/mocks" start     # listens on :4141 (override with MOCKS_PORT)
curl localhost:4141/health
```

The Playwright config (`services/platform/playwright.config.ts`) boots it
automatically in hermetic mode (`E2E_MOCK_LLM` ≠ `0`).

## Wiring it into the app (fully offline)

- **AI providers** need no special wiring — the provider config `baseUrl` points
  at the gateway (`services/platform/tests/e2e/fixtures/config/default/providers/e2e-mock.json`
  → `http://127.0.0.1:4141/v1`), which already covers chat, embeddings, image
  generation, transcription, and TTS.
- **Connectors** hardcode their upstream base URLs, so they are
  redirected at the sandbox HTTP seam: when `TALE_MOCK_CONNECTORS_BASE` is set
  (the Playwright config sets it to the gateway), `convex/node_only/connector_sandbox/
helpers/mock_rewrite.ts` maps a known upstream origin (`api.github.com`,
  `slack.com`, `*.atlassian.net`, …) to `<base>/mock/<connector>/…`. That host
  table mirrors `src/registry.ts`; the contract tests catch drift.

## Tests (`bun test`)

- `src/contract/openai-compat.test.ts` — the chat override scenarios + every
  Prism-served AI endpoint, plus a byte-identical determinism check.
- `src/contract/connectors.test.ts` — `resolveMockUrl` rewrite mapping + each
  connector serving the exact shape its connector parses.

The real **connector → rewrite → gateway** path is exercised end-to-end (offline)
by the Playwright suite. The existing `*_connector.test.ts` unit tests (which mock
`globalThis.fetch` directly) are unchanged and still assert request URLs/sequencing.

## Adding / extending a spec

1. Read the connector (`configs/platform/system/connectors/<name>/connector.yml`) for
   the operations, paths, and the response fields it parses.
2. Add `specs/connectors/<name>.openapi.yaml` — `servers: [{ url: /mock/<name> }]`,
   paths = the full upstream path **after the hostname**, one `example` per response.
3. Register it in `src/registry.ts` (and mirror the host → prefix in the Convex
   `mock_rewrite.ts`).
4. Add a contract test asserting the connector-critical shape.

The gateway skips a registered-but-missing spec with a warning, so partial
authoring is safe.

## Note on container tests

`services/platform/tests/integration/container-smoke-test.ts` only probes health endpoints and the
sandbox `/v1/execute` contract — it makes no external AI/connector calls, so it
already runs offline and does not need the gateway. If that suite ever drives
chat or connector flows, add an `api-mocks` service to `compose.test.yml` and
set `TALE_MOCK_CONNECTORS_BASE` + the provider `baseUrl` on the convex service.
