# @tale/ai-gateway

One place to hold the AI subscriptions a team already pays for — **Claude
Pro/Max** and **ChatGPT Plus/Pro** accounts — and one endpoint that hands
their OAuth tokens out.

Each account is added through its own vendor's normal login. The gateway
stores the tokens encrypted, refreshes them before they expire, shows how much
of each plan is spent, and answers `GET /api/tokens` with every token it holds.

> Use this only with accounts you own, within each vendor's terms.

## What it does

| | |
| --- | --- |
| **One token endpoint** | `GET /api/tokens` answers with every account's access token, its expiry, its status, and the environment variable that hands it to the vendor's CLI |
| **Two providers, one shape** | Anthropic and OpenAI differ in their OAuth callback, their identity claims and their usage payload; the panel and the endpoint do not |
| **Always-fresh tokens** | A background pass refreshes each access token ahead of its expiry, so an account stays usable as long as its refresh token does |
| **Usage in view** | Each account's session and weekly windows — plus any per-model cap the vendor reports — as live bars |
| **Encrypted at rest** | AES-256-GCM under `AI_GATEWAY_ENCRYPTION_KEY`; a tampered store fails loudly rather than decrypting to something plausible |
| **Two doors, kept apart** | The panel is behind a password; the token endpoint is behind an API key. Neither opens the other |

## Run it

```bash
bun run --filter @tale/ai-gateway dev     # Vite + the API on :3004
```

Development generates the four secrets it needs and prints them once. Put them
in your environment to keep them across restarts — a new `AI_GATEWAY_ENCRYPTION_KEY`
cannot decrypt what the previous one sealed.

Production refuses to start without them and says which are missing:

```bash
bun run --filter @tale/ai-gateway build
AI_GATEWAY_API_KEY=… AI_GATEWAY_PANEL_PASSWORD=… \
AI_GATEWAY_SESSION_SECRET=… AI_GATEWAY_ENCRYPTION_KEY=… \
  bun run --filter @tale/ai-gateway start
```

Generate a set:

```bash
bun -e 'const c=require("node:crypto");for(const k of ["AI_GATEWAY_API_KEY","AI_GATEWAY_PANEL_PASSWORD","AI_GATEWAY_SESSION_SECRET"])console.log(`${k}=${c.randomBytes(32).toString("base64url")}`);console.log(`AI_GATEWAY_ENCRYPTION_KEY=${c.randomBytes(32).toString("base64")}`)'
```

## Add an account

Open the panel, sign in, and choose **Add account**. Each provider's consent
happens in a browser this service does not control, so the second step asks for
what the browser gave back:

| Provider | What you paste back |
| --- | --- |
| **Anthropic (Claude)** | The code Anthropic's console callback page prints after you approve |
| **OpenAI (ChatGPT)** | The whole address the browser landed on — the Codex client redirects to `http://localhost:1455/auth/callback`, which will not load unless Codex is listening, and the address bar still carries the code |

Both flows are the public OAuth client each vendor's own CLI uses, with a PKCE
S256 challenge.

## Use the tokens

```bash
curl localhost:3004/api/tokens -H "Authorization: Bearer $AI_GATEWAY_API_KEY"
```

```json
{
  "tokens": [
    {
      "id": "…",
      "provider": "anthropic",
      "label": "you@example.com",
      "accountEmail": "you@example.com",
      "accountId": null,
      "status": "active",
      "accessToken": "sk-ant-oat01-…",
      "expiresAt": "2026-10-21T09:40:00Z",
      "scopes": "org:create_api_key user:profile user:inference",
      "envVar": "ANTHROPIC_AUTH_TOKEN"
    }
  ]
}
```

`envVar` is the variable that hands that token to the provider's own CLI —
`ANTHROPIC_AUTH_TOKEN` for Claude Code, `CODEX_ACCESS_TOKEN` for Codex. The
panel's **Copy CLI command** action composes the same thing:

```bash
ANTHROPIC_AUTH_TOKEN=<access_token> claude
CODEX_ACCESS_TOKEN=<access_token> codex
```

Every non-expired token is refreshed-if-stale before the endpoint answers, so a
caller never receives one that is about to expire.

## Routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/` | panel session | The panel |
| `GET`/`POST`/`DELETE` | `/api/session` | password | Read, start, end the panel session |
| `GET` | `/api/providers` | panel session | The providers an account can be added for |
| `GET` | `/api/accounts` | panel session | The pool, without any credential |
| `POST` | `/api/accounts/authorize` | panel session | Start an authorization; answers the URL to open |
| `POST` | `/api/accounts/complete` | panel session | Finish one with what the browser gave back |
| `GET` | `/api/accounts/{id}/command` | panel session | A ready-to-run CLI command for that account |
| `DELETE` | `/api/accounts/{id}` | panel session | Remove an account |
| `GET` | `/api/tokens` | API key | Every stored token |
| `GET` | `/api/health` | none | Liveness probe |

## Configuration

| Variable | Default | What it is |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | — | Guards `GET /api/tokens`. Required |
| `AI_GATEWAY_PANEL_PASSWORD` | — | The panel login. Required |
| `AI_GATEWAY_SESSION_SECRET` | — | Signs the panel session cookie; changing it signs everyone out. Required |
| `AI_GATEWAY_ENCRYPTION_KEY` | — | 32 base64-encoded bytes; encrypts the stored tokens. Required, and irreplaceable — a new key cannot read the old store |
| `AI_GATEWAY_DATA_DIR` | `.data` | Where `accounts.json` lives. Back this up; it is the pool |
| `AI_GATEWAY_REFRESH_INTERVAL_SECONDS` | `300` | Cadence of the background refresh pass |
| `AI_GATEWAY_USAGE_MIN_INTERVAL_SECONDS` | `180` | Floor between two usage reads for one account; both vendors rate-limit this hard |
| `AI_GATEWAY_TOKEN_REFRESH_SKEW_SECONDS` | `300` | How long before expiry a token is refreshed anyway |
| `AI_GATEWAY_CLAUDE_CODE_VERSION` | `1.0.0` | Reported as `claude-code/<version>` to Anthropic's usage endpoint |
| `AI_GATEWAY_ANTHROPIC_CLIENT_ID` | the CLI's | Override only if Anthropic rotates its public client |
| `AI_GATEWAY_OPENAI_CLIENT_ID` | the CLI's | Override only if OpenAI rotates its public client |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | — | Error reporting. Absent, nothing is reported |

## Add a third provider

A provider is one module under `backend/providers/` implementing the `Provider`
contract in [`backend/providers/types.ts`](backend/providers/types.ts) —
authorize, exchange, refresh, identity, usage — plus one line in
[`backend/providers/index.ts`](backend/providers/index.ts) and its id in
`PROVIDER_IDS`. Nothing above that layer knows which vendor a row belongs to.
A new id needs a `providers.<id>` label in every message catalog.

## Layout

| Path | What is there |
| --- | --- |
| `backend/providers/` | One module per vendor, plus the OAuth pieces they share |
| `backend/accounts.ts` | The lifecycle: authorize, refresh, read usage, hand out |
| `backend/store.ts` | The account document, written atomically and serialized |
| `backend/routes.ts` | The two doors |
| `backend/gateway.ts` | Composition root; used by `server.ts` and the Vite dev plugin alike |
| `app/` | The panel — one screen, built on `@tale/ui` |

## Develop

```bash
bun run --filter @tale/ai-gateway lint
bun run --filter @tale/ai-gateway typecheck
bun run --filter @tale/ai-gateway test        # node + jsdom projects
bun run --filter @tale/ai-gateway test:e2e    # Playwright, boots the dev server
```

For UI changes, check keyboard access, focus, and narrow layouts in the
browser. Follow the [manual test guide](tests/manual/readme.md) and the
repository's design and translation contracts.
