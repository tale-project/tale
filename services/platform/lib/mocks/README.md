# Local API mock gateway

This gateway serves deterministic fixture responses for the platform's AI-provider and
enterprise-SSO tests. It is part of `@tale/platform`, not a separate Bun workspace. A passing mock
test proves a request or UI contract; it does not prove a real provider's availability, output
quality, or credentials.

## Run the gateway

From `services/platform`:

```bash
bun lib/mocks/start.ts
```

In another terminal:

```bash
curl --fail http://127.0.0.1:4141/health
```

`MOCKS_PORT` overrides port 4141. Keep the chosen port in sync with the provider fixture and the
test configuration, and give the docs screenshot capture the same `MOCKS_PORT`: its preflight probes
that port. Playwright starts the gateway in its default mock mode; the docs screenshot runbook
starts it explicitly.

## Routes and fixtures

| Route | Implementation |
| --- | --- |
| `GET /health` | Readiness probe |
| `POST /v1/chat/completions` | Streaming and scenario overrides in `overrides/chat-completions.ts` |
| `POST /v1/embeddings` | Deterministic embedding override in `overrides/embeddings.ts` |
| Other `/v1/*` operations | OpenAI-compatible fixture spec |
| `/mock/sso-idp/*` | OIDC discovery, token and userinfo examples for enterprise SSO, served through Prism |

[`registry.ts`](registry.ts) lists the mounted specs and their mount prefixes. The gateway strips
the mount prefix before matching the spec's operation. [`gateway.ts`](gateway.ts) constructs the
handlers; [`specs/`](specs/) owns request and response examples. The specs cover the operations they
list, not every operation an upstream service offers.

## Connect a test organization

Configure an AI provider whose base URL points to `http://127.0.0.1:4141/v1`, connect a synthetic
credential, and select a model from its catalog. The backend needs
`TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1` to accept the local provider address. Document indexing also
needs its own embedding configuration, a working knowledge database, and object storage.

The [screenshot seeder](../../tests/docs-screenshots/seed-demo-org.ts) performs those UI setup steps.
Its [runbook](../../tests/docs-screenshots/README.md) describes the complete stack.

The gateway has no connector stand-ins, and nothing redirects a connector's calls to it. A test that
must not reach a vendor runs the connector's actions on their scenarios
([CONN-R33](../../backend/domains/connectors/spec.md)): an automation test picks a scenario for a
step ([AUTO-R78](../../backend/domains/automations/spec.md)), and an agent runs an automation on
stand-ins ([MCP-R34](../../backend/domains/mcp/spec.md)).

## Test and extend a fixture

From `services/platform`:

```bash
bunx vitest run --project server lib/mocks/contract lib/mocks/overrides/docs-replies.test.ts
```

The contract tests check response shapes, deterministic model scenarios, and the identity provider's
OIDC answers. For a new operation, inspect the real caller's requests and parsed fields, add a
representative example to its OpenAPI spec, then add a contract assertion for the fields the caller
actually uses. Register a new spec in `registry.ts` and check the gateway startup output for
missing-spec warnings.

Chat scenario strings and documentation responses live under [`overrides/`](overrides/). Use them
for controlled UI states; do not paste a mock response into documentation as evidence of real model
reasoning or retrieval accuracy.
