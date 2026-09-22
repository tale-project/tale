# @tale/ai-gateway

One place to hold the AI subscriptions a team already pays for — **Claude
Pro/Max** and **ChatGPT Plus/Pro** accounts — and one endpoint that hands
their OAuth tokens out.

Each account is added through its own vendor's normal login. The gateway
stores the tokens encrypted, refreshes them before they expire, shows how much
of each plan is spent, and hands the tokens out — one endpoint per vendor, and
one that serves the whole pool.

> Use this only with accounts you own, within each vendor's terms.

## What it does

| | |
| --- | --- |
| **One endpoint per vendor** | `GET /api/tokens/anthropic` and `GET /api/tokens/openai` answer with that vendor's access tokens, expiries and statuses; `GET /api/tokens` serves the whole pool |
| **cc-gateway's wire shape** | `{"tokens": [{ id, label, account_email, status, access_token, expires_at, scopes }]}` — a broker mapping written against the retired cc-gateway reads this one unchanged |
| **Two providers, one shape** | Anthropic and OpenAI differ in their OAuth callback, their identity claims and their usage payload; the panel and the endpoint do not |
| **Always-fresh tokens** | A background pass refreshes each access token ahead of its expiry, so an account stays usable as long as its refresh token does |
| **Usage in view** | Each account's session and weekly windows — plus any per-model cap the vendor reports — as live bars, beside a grey one counting that window down to its rollover |
| **Encrypted at rest** | AES-256-GCM under `AI_GATEWAY_ENCRYPTION_KEY`; a tampered store fails loudly rather than decrypting to something plausible |
| **One lock, on the tokens** | The token endpoints are behind an API key. The panel has no login of its own — whatever fronts this service decides who reaches it |

## Run it

```bash
bun run --filter @tale/ai-gateway dev     # Vite + the API on :3004
```

Development generates the two secrets it needs and prints them once. Put them
in your environment to keep them across restarts — a new `AI_GATEWAY_ENCRYPTION_KEY`
cannot decrypt what the previous one sealed.

Production refuses to start without them and says which are missing:

```bash
bun run --filter @tale/ai-gateway build
AI_GATEWAY_API_KEY=… AI_GATEWAY_ENCRYPTION_KEY=… \
  bun run --filter @tale/ai-gateway start
```

Generate a set:

```bash
bun -e 'const c=require("node:crypto");console.log(`AI_GATEWAY_API_KEY=${c.randomBytes(32).toString("base64url")}`);console.log(`AI_GATEWAY_ENCRYPTION_KEY=${c.randomBytes(32).toString("base64")}`)'
```

## Who may open the panel

Nobody is asked to sign in. The panel adds, re-authorizes and removes accounts
without a credential of its own, so **put it behind something**: the fleet
deployment serves it through an SSO gateway and lets only `/api/tokens*` and
`/api/health` past. Run it on a public address with nothing in front and the
pool is open to whoever finds it.

## Add an account

Open the panel and choose **Add account**. Each provider's consent
happens in a browser this service does not control, so the second step asks for
what the browser gave back:

| Provider | What you paste back |
| --- | --- |
| **Anthropic (Claude)** | The code Anthropic's console callback page prints after you approve |
| **OpenAI (ChatGPT)** | The whole address the browser landed on — the Codex client redirects to `http://localhost:1455/auth/callback`, which will not load unless Codex is listening, and the address bar still carries the code |

Both flows are the public OAuth client each vendor's own CLI uses, with a PKCE
S256 challenge.

## Use the tokens

Ask for one vendor — a caller almost always wants one, and a client pointed at
the wrong vendor's token authenticates against the wrong API:

```bash
curl localhost:3004/api/tokens/anthropic -H "Authorization: Bearer $AI_GATEWAY_API_KEY"
curl localhost:3004/api/tokens/openai    -H "Authorization: Bearer $AI_GATEWAY_API_KEY"
```

```json
{
  "tokens": [
    {
      "id": "…",
      "label": "you@example.com",
      "account_email": "you@example.com",
      "status": "active",
      "access_token": "sk-ant-oat01-…",
      "expires_at": "2026-10-21T09:40:00Z",
      "scopes": "org:create_api_key user:profile user:inference"
    }
  ]
}
```

That is the shape the retired **cc-gateway** answered with, field for field,
so anything written against it — the platform's `subscription-broker`
credential included — reads this one with no remapping. The one difference is
`id`: a string here, where cc-gateway had SQLite row integers.

`GET /api/tokens` still serves the whole pool. Because a mixed payload cannot
say which vendor a token belongs to from its URL, each of its entries carries
one extra field, `provider`.

An unknown vendor is a 404 (`unknown_provider`); a vendor with no accounts is
a 200 and an empty array.

To run a vendor's CLI on a token, the panel's **Copy CLI command** action
composes the whole line:

```bash
ANTHROPIC_AUTH_TOKEN=<access_token> claude
CODEX_ACCESS_TOKEN=<access_token> codex
```

Every non-expired token is refreshed-if-stale before an endpoint answers, so a
caller never receives one that is about to expire — and asking for one vendor
refreshes only that vendor's accounts.

## Routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/` | none | The panel |
| `GET` | `/api/providers` | none | The providers an account can be added for |
| `GET` | `/api/accounts` | none | The pool, without any credential |
| `POST` | `/api/accounts/authorize` | none | Start an authorization; answers the URL to open |
| `POST` | `/api/accounts/complete` | none | Finish one with what the browser gave back |
| `GET` | `/api/accounts/{id}/command` | none | A ready-to-run CLI command for that account |
| `DELETE` | `/api/accounts/{id}` | none | Remove an account |
| `GET` | `/api/tokens/{provider}` | API key | One vendor's tokens, in cc-gateway's shape |
| `GET` | `/api/tokens` | API key | The whole pool, each token named by vendor |
| `GET` | `/api/health` | none | Liveness probe |

"None" means the app checks nothing — see [Who may open the panel](#who-may-open-the-panel).

## Configuration

| Variable | Default | What it is |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | — | Guards every `GET /api/tokens*`. Required |
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
`PROVIDER_IDS`. Nothing above that layer knows which vendor a row belongs to:
its `/api/tokens/<id>` endpoint comes with the id. A new id needs a
`providers.<id>` label in every message catalog.

## Layout

| Path | What is there |
| --- | --- |
| `backend/providers/` | One module per vendor, plus the OAuth pieces they share |
| `backend/accounts.ts` | The lifecycle: authorize, refresh, read usage, hand out |
| `backend/store.ts` | The account document, written atomically and serialized |
| `backend/routes.ts` | The HTTP surface, and the API key that guards the tokens |
| `backend/gateway.ts` | Composition root; used by `server.ts` and the Vite dev plugin alike |
| `app/` | The panel — one screen, no door, built on `@tale/ui` |

The panel is one screen in the documentation frame's chrome: an `h-13` header
strip carrying the Tale mark, the service's name and the language / theme /
repository cluster, over a single full-height account table. Language is a
stored preference here, not a path segment — the panel ships as one
untranslated tree — so the shared `LanguageSwitcher` runs in its state-driven
mode.

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
