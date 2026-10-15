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
| **One endpoint per vendor** | `GET /api/tokens/anthropic` and `GET /api/tokens/openai` answer with that vendor's access tokens, identities and quota availability; `GET /api/tokens` serves the whole pool |
| **Compatible token fields** | Keeps cc-gateway's `id`, `label`, `account_email`, `status`, `access_token`, `expires_at` and `scopes`, adding metadata for selection — `refresh_at` and `hold` among it — without changing those names |
| **Two providers, one shape** | Anthropic and OpenAI differ in their OAuth callback, their identity claims and their usage payload; the panel and the endpoint do not |
| **Connects on its own** | A ChatGPT account connects through OpenAI's device sign-in, and a Claude account — when the panel is opened on localhost — through a redirect straight back to the gateway; there is no code to carry back |
| **Token refresh** | Each account's token is refreshed on a schedule of its own, spread across the pool and spaced out per vendor, with a shared-expiry exception; while another account can take new work, one whose planned refresh (`refresh_at`) is closer than the hand-out floor waits for it; transient failures pause retries, an authenticated usage rejection refreshes that exact token generation through the same single-flight path, and refused refresh grants require a new sign-in |
| **Usage in view** | Each account's session and weekly windows — plus any per-model cap the vendor reports — as live bars coloured by how much is spent (green, yellow from half, orange from three quarters, red at the ceiling), beside a short grey one counting the window down to its rollover |
| **When an account is back** | An account whose session or weekly window is spent is **Limit reached**, and comes back when its *last* spent window rolls over — a session that resets in five minutes beside a spent week is back in three days, and the row says so (**Resets in 3 days**) and reads the week's clock in full strength while the session's steps back. Within the hour the clock turns green. The row greys out like a disabled row until then — only the look: its menu keeps working, and so do its state and its clock |
| **Grouped by what each account is doing** | Vendors together, in the catalog's order; inside a vendor the accounts that can take work, then the ones that hit their limit — soonest back first, no known return last — then the ones that need a person (**Needs reauthentication**, **Last call failed**). The filter and the search know the same states |
| **A REST API for accounts** | `/api/v1/accounts` lists and reads the pool, with the same state and return time the panel shows; with a second key it also starts and completes an authorization and removes an account — see [Manage accounts over REST](#manage-accounts-over-rest) |
| **The plan, named** | Each account's plan as its vendor sells it — Max 20x, Pro, Plus, Pro Lite — read from Anthropic's profile and from ChatGPT's own usage answer |
| **Encrypted at rest** | AES-256-GCM under `AI_GATEWAY_ENCRYPTION_KEY`; a tampered store fails loudly rather than decrypting to something plausible |
| **Locks on the machine doors** | The token endpoints and `/api/v1` are behind API keys — one that reads, and a separate admin key that changes the pool. The panel has no login of its own — whatever fronts this service decides who reaches it |

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

Whatever sits in front owns the session, and ends it on its own clock. No
route the panel calls redirects or answers 401, so the panel reads either as
that session having run out: it keeps the account list it has, says the session
expired, and offers **Sign in again** — a page load, the one request a sign-in
gate can send through its identity provider and back. A re-read that fails for
any other reason keeps the list too, says it could not be refreshed, and tries
again every minute.

## Add an account

Open the panel and choose **Add account**. Each provider's consent happens on
the vendor's own page; how it gets back to the gateway depends on what the
vendor allows from where you opened the panel:

| Provider | Panel opened on | What happens after you approve |
| --- | --- | --- |
| **OpenAI (ChatGPT)** | anywhere | Nothing more to do. The dialog shows a one-time code and a link to OpenAI's sign-in page; enter the code there and approve, and the gateway connects the account on its own — the device sign-in `codex login --device-auth` uses |
| **Anthropic (Claude)** | `localhost` | Nothing more to do. The page goes to Anthropic and comes straight back to the gateway's own `/callback`, which connects the account |
| **Anthropic (Claude)** | any other address | Paste the code Anthropic's console page prints. Anthropic's client redirects only to a loopback address and has no device sign-in for a subscription, so nothing can come back to a public host by itself |

To get the automatic Claude flow on a remote gateway, open its panel through
an SSH tunnel to the gateway's port (`ssh -L 3004:localhost:<port> <host>`,
then `http://localhost:3004`). OpenAI's browser flow stays behind **Sign in
through the browser instead** for a workspace that does not allow device
sign-in; it ends on `http://localhost:1455/auth/callback`, which will not load
unless Codex is listening, so you paste the whole address bar.

Every flow is the public OAuth client each vendor's own CLI uses, with a PKCE
S256 challenge. Closing the dialog abandons the attempt.

## Manage accounts over REST

Everything the panel shows about an account — and the three things it lets you do to
one — is also a REST API, for a script or another service. It lives under `/api/v1`, on
its own prefix, so a proxy that lets machines reach `/api/tokens*` can let them reach
this the same way without opening a single panel route.

Two keys, because reading a pool and changing it are not the same trust:

| Key | May | Where it is set |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` — the token key | **Read** accounts (`GET`) | Required; it is the key the token endpoints already ask for. Everything an account's figures show is a subset of what that key reads from `/api/tokens` already |
| `AI_GATEWAY_ADMIN_API_KEY` — the admin key | Read, and **change**: start and complete an authorization, remove an account | Optional. Without it, changing answers `403 control_disabled` and nothing can be added or removed over the API |

Adding an account puts someone else's subscription into the pool the platform draws
from, which is not something every holder of a token key should be able to do — so the
two are apart by default. To run with one key, set both variables to the same value.

Send a key as `Authorization: Bearer <key>` or `x-api-key: <key>`. A missing or wrong key
is `401 invalid_api_key`; a right key that may not do this is `403`
(`admin_key_required`, or `control_disabled` while no admin key is set). Every answer from
these routes, a refusal included, is `Cache-Control: no-store`, and names are snake_case
like the token endpoints'.

```bash
curl localhost:3004/api/v1/accounts -H "Authorization: Bearer $AI_GATEWAY_API_KEY"
```

```json
{
  "accounts": [
    {
      "id": "gateway-account-1",
      "provider": "anthropic",
      "label": "you@example.com",
      "account_email": "you@example.com",
      "subscription": { "plan": "max", "tier": "5x" },
      "status": "active",
      "state": "limited",
      "limited_until": "2026-10-18T10:00:00.000Z",
      "expires_at": "2026-10-21T09:40:00.000Z",
      "scopes": "org:create_api_key user:profile user:inference",
      "created_at": "2026-09-26T10:00:00.000Z",
      "last_refreshed_at": "2026-10-15T07:12:30.000Z",
      "usage": {
        "checked_at": "2026-10-15T10:00:00.000Z",
        "stale": false,
        "limited": null,
        "windows": [
          {
            "kind": "session",
            "label": null,
            "utilization": 100,
            "resets_at": "2026-10-15T10:05:00.000Z",
            "window_seconds": 18000,
            "blocking": true
          },
          {
            "kind": "weekly",
            "label": null,
            "utilization": 100,
            "resets_at": "2026-10-18T10:00:00.000Z",
            "window_seconds": 604800,
            "blocking": true
          }
        ]
      }
    }
  ]
}
```

No token, refresh token or other credential is ever in an answer; the token endpoints are
the only door that hands those out.

**`state`** says what the account is now, in one word, and is what the panel groups on:

| `state` | Means |
| --- | --- |
| `available` | Nothing stops it taking work, as far as its latest reading shows |
| `limited` | Its session or weekly window is spent. `limited_until` is when it is back: the **latest** rollover among its spent windows — five minutes for a spent session beside a spent week is still three days. Null when a spent window has no stated rollover, or when only the vendor's own `usage.limited` flag says so |
| `expired` | The vendor refused a refresh; someone must sign the account in again. `status` says the same |
| `error` | The latest call to the vendor failed; the gateway keeps trying. `status` says the same |

`status` stays the credential's own (`active`, `expired`, `error`), as on the token
endpoints; `state` refines `active` into `available` and `limited`. A window's
`blocking` is true when it is why the account is limited — spent, a session or weekly
window rather than a per-model cap, and not yet rolled over. A window whose rollover
has already passed stops blocking at once, before the next reading says so, and
`usage.stale` turns true: the figures are those of the window before. This describes the
account as its own reading shows it; whether the pool will hand it out for *new* work —
which also weighs how fresh the reading is and how close its token is to refresh — is
still the token endpoints' `available`.

| Method | Path | Key | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/accounts` | token or admin | The pool, oldest account first. `?provider=anthropic\|openai` and `?state=available\|limited\|expired\|error` narrow it; an unknown value is `400 invalid_request` |
| `GET` | `/api/v1/accounts/{id}` | token or admin | One account, or `404 unknown_account` |
| `POST` | `/api/v1/authorizations` | admin | Start an authorization: `{"provider": "anthropic" \| "openai", "label"?, "account_id"?, "method"?: "browser"}`. `account_id` signs an existing account in again. Answers `201` with how it finishes — `flow: "device"` (`verification_url`, `user_code`, `expires_at`, `poll_interval_seconds`: approve the code in a browser, and the gateway connects the account itself) or `flow: "paste"` (`authorize_url`, `paste_style`: approve, then send what the browser shows) |
| `GET` | `/api/v1/authorizations/{state}` | admin | Where it stands: `pending`, `connected` (with the `account`) or `failed` (with a `code`). For a device code each read may ask the vendor, so poll no faster than `poll_interval_seconds` |
| `POST` | `/api/v1/authorizations/{state}/complete` | admin | Finish a paste flow: `{"pasted": "<what the browser gave back>"}`. Answers `201` with the `account` |
| `DELETE` | `/api/v1/accounts/{id}` | admin | Remove an account and its stored tokens: `204`, or `404 unknown_account` |

A script never gets a redirect flow: that one needs a browser on a loopback address of
the gateway's own machine, which only the panel can offer. For a Claude account it asks
for the `paste` flow, and a ChatGPT account for its device code.

```bash
# Add a ChatGPT account from a script: approve the code in a browser, and wait.
curl -X POST localhost:3004/api/v1/authorizations \
  -H "Authorization: Bearer $AI_GATEWAY_ADMIN_API_KEY" \
  -H "Content-Type: application/json" -d '{"provider": "openai"}'
curl localhost:3004/api/v1/authorizations/$STATE \
  -H "Authorization: Bearer $AI_GATEWAY_ADMIN_API_KEY"
```

Behind a proxy that fronts the panel with a sign-in, `/api/v1/*` has to be passed past that
sign-in the way `/api/tokens*` is — it carries its own keys, and nothing else guards it.

## Use the tokens

Ask for one vendor — a caller almost always wants one, and a client pointed at
the wrong vendor's token authenticates against the wrong API:

```bash
curl localhost:3004/api/tokens/anthropic -H "Authorization: Bearer $AI_GATEWAY_API_KEY"
curl localhost:3004/api/tokens/openai    -H "Authorization: Bearer $AI_GATEWAY_API_KEY"
```

The platform adds `X-Tale-Force-Refresh: 1` when retrying a broker-served
inference after a vendor 401. The API-key token door then refreshes the stored
grant before handing the pool back, even when the cached expiry and usage
reading still look fresh; ordinary handouts keep the normal staggered refresh
policy. Forced handouts retain terminal re-authentication states and the
retry pause after a transient refresh failure.

```json
{
  "tokens": [
    {
      "id": "gateway-account-1",
      "provider": "anthropic",
      "account_id": null,
      "label": "you@example.com",
      "account_email": "you@example.com",
      "status": "active",
      "access_token": "sk-ant-oat01-…",
      "expires_at": "2026-10-21T09:40:00Z",
      "refresh_at": "2026-10-21T07:12:30Z",
      "scopes": "org:create_api_key user:profile user:inference",
      "available": true,
      "available_at": null,
      "hold": null,
      "usage": {
        "checked_at": "2026-09-26T10:00:00Z",
        "limited": null,
        "windows": [
          {
            "kind": "weekly",
            "label": null,
            "utilization": 20,
            "resets_at": "2026-09-29T10:00:00Z",
            "window_seconds": 604800
          }
        ]
      }
    }
  ]
}
```

This example uses a synthetic account id and a shortened token. The original
**cc-gateway** fields keep their meanings, so existing token mappings still
work. `id` is a stable gateway account string, where cc-gateway used SQLite
row integers. Use it for selection and retry exclusions: token bytes change
when a token refreshes. `account_id` is the vendor's own identity instead;
OpenAI's ChatGPT account id must accompany its access token.

`refresh_at` is when the gateway plans to refresh the token, and a refresh
ends the token it replaces — Anthropic revokes the previous access token — so
`refresh_at`, not the vendor's `expires_at`, is the end of a handed-out
token's usable life. It is null when the vendor stated no expiry.

Both endpoint shapes include `provider`. A caller should require the expected
vendor, an `active` status, and `available: true` before selecting a
credential; `refresh_at` reports its planned refresh, which may be deferred by vendor spacing. The gateway
reports the pool; the consumer owns distribution between its eligible entries,
and the fallback described below when its own rules leave it none.

`available` says whether the account may take new work — its quota, and the
hand-out floor below — independently of credential status. A session or
weekly window at 100% makes it false until its reset. OpenAI's
explicit `allowed: false` or `limit_reached: true` also makes it false, even
with rounded or absent percentages; `usage.limited` preserves that signal
(`null` when the vendor does not report it). Contradictory flags are treated
as limited. An explicit limit without a matching full window has no known
reset: `available_at` stays null until a new reading or the freshness limit
releases it. A
model-specific (`scoped`) cap does not remove the whole account. When several
general windows are exhausted, `available_at` is their latest reset; it is
null when any blocking window has no known reset. A passed reset stops
blocking even if the next usage read has not happened yet.

`available` also turns false while an account's planned refresh is closer
than `AI_GATEWAY_TOKEN_MIN_HANDOUT_SECONDS` (an hour by default) and another
active account of the same vendor — with quota left and outside its own floor
— can take the work instead. `available_at` is then `refresh_at`: new work
waits for the fresh token rather than taking one that would be revoked under
it, and the lifetime restriction ends once the refresh lands; quota restrictions still apply. When no other
account can take the work, the held-back account with the latest `refresh_at`
is served as available anyway, so a pool of one account is never held back: a
turn that a refresh may cut can still recover on a fresh token instead of a
pool that refuses all work. The gateway judges "another account can take the
work" by its own view of the pool, which knows nothing of a consumer's rules —
a cooldown after a rate limit, a vendor account id it requires. So an account
held back only by the floor says `hold: "refresh"`, and a consumer those rules
leave with no available account may start work on it anyway, the latest
`refresh_at` first, as the gateway would itself; an account with
`hold: "quota"` has no quota left for it. `hold` names which block holds an
unavailable account back — `quota` when both do — and is null while the
account is available. When a due refresh keeps failing, the token may still
work but its end cannot be promised; the account is held back like one
inside its floor, with `available_at: null`. A token whose whole planned life
is shorter than the floor is handed out until its planned refresh is due, since
the next one would be no longer, and an `expired` account is left to its status. The floor covers the
start of the work, not a run longer than the floor: a consumer still holding a
token after its actual refresh may receive a 401 and should request credentials again.

Usage is refreshed on token requests subject to
`AI_GATEWAY_USAGE_MIN_INTERVAL_SECONDS`. The gateway ignores exhaustion from
readings 15 minutes old or older, future timestamps, or absent readings, and
reports `available: true` in those cases. This keeps a metrics outage from
stranding accounts indefinitely; it is not a guarantee that the next inference
request has capacity. `usage.checked_at` records the last successful read.
A failed read keeps that timestamp and its figures, without changing a valid
credential's status. `usage` is null before any successful read.

An unknown vendor is a 404 (`unknown_provider`); a vendor with no accounts is
a 200 and an empty array.

To run a vendor's CLI on a token, the panel's **Copy CLI command** action
composes the whole line. The Claude command uses its OAuth channel and clears
the credentials that could take precedence. With the token in `ACCESS_TOKEN`:

```bash
env -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY \
  CLAUDE_CODE_OAUTH_TOKEN="$ACCESS_TOKEN" claude
```

For Codex, put the token in `ACCESS_TOKEN` and the response's `account_id` in
`CHATGPT_ACCOUNT_ID`. Its ChatGPT Responses endpoint needs both. The command
uses environment variables for credential delivery; `CODEX_ACCESS_TOKEN`
selects a different authentication protocol and is not the subscription
token variable.

```bash
env -u CODEX_ACCESS_TOKEN -u CODEX_API_KEY -u OPENAI_API_KEY \
  TALE_SUBSCRIPTION_TOKEN="$ACCESS_TOKEN" \
  TALE_SUBSCRIPTION_ACCOUNT_ID="$CHATGPT_ACCOUNT_ID" codex \
  -c 'model_provider="tale-subscription"' \
  -c 'model_providers.tale-subscription.name="ChatGPT"' \
  -c 'model_providers.tale-subscription.base_url="https://chatgpt.com/backend-api/codex"' \
  -c 'model_providers.tale-subscription.env_key="TALE_SUBSCRIPTION_TOKEN"' \
  -c 'model_providers.tale-subscription.env_http_headers={"ChatGPT-Account-ID"="TALE_SUBSCRIPTION_ACCOUNT_ID"}' \
  -c 'model_providers.tale-subscription.wire_api="responses"' \
  -c 'model_providers.tale-subscription.requires_openai_auth=false'
```

The gateway refreshes a token once its planned refresh is due, before
answering. The plan is the vendor's expiry less
`AI_GATEWAY_TOKEN_REFRESH_SKEW_SECONDS`, brought forward by the account's own
share — a stable hash of its id — of half the time between the token's issue
and that point. Two accounts refreshed together therefore fall due at
different times, and, each on a cycle of its own length, do not stay in step.
When two accounts of one vendor still fall due together — by chance, or on
the first pass after an outage or an upgrade — the second waits until ten
minutes after the first refresh, though never past its skew point, where its
own token is about to expire. Refreshes are normally separated; accounts already at their skew point can refresh together. A request refreshes only the accounts that
are due; the others keep their tokens.

Consumers still check status because a vendor can refuse or fail a refresh.
One vendor's token request refreshes only that vendor's accounts. Accounts of
different vendors are refreshed concurrently, overlapping calls share the work
per account, and
each provider HTTP request has a four-second deadline. An unreadable stored
credential is marked expired and omitted without taking the rest of the pool
offline. Token and copied-command responses use `Cache-Control: no-store`.

## Routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/` | none | The panel |
| `GET` | `/api/providers` | none | The providers an account can be added for |
| `GET` | `/api/accounts` | none | The pool, without any credential |
| `POST` | `/api/accounts/authorize` | none | Start an authorization; answers how it comes back (`device`, `redirect` or `paste`) and what to show meanwhile |
| `GET` | `/api/accounts/authorize/{state}` | none | Where an authorization stands; for a device code, also asks the vendor whether it was approved |
| `POST` | `/api/accounts/complete` | none | Finish a paste flow with what the browser gave back |
| `GET` | `/callback` | none | Where a vendor's loopback redirect lands; finishes the grant and sends the browser back to the panel |
| `GET` | `/api/accounts/{id}/command` | none | A ready-to-run CLI command for that account |
| `DELETE` | `/api/accounts/{id}` | none | Remove an account |
| `GET` | `/api/tokens/{provider}` | API key | One vendor's tokens, in cc-gateway's shape |
| `GET` | `/api/tokens` | API key | The whole pool, each token named by vendor |
| `GET` | `/api/v1/accounts`, `/api/v1/accounts/{id}` | API key or admin key | The pool and one account, without any credential — [Manage accounts over REST](#manage-accounts-over-rest) |
| `POST` | `/api/v1/authorizations` | admin key | Start an authorization (device code or paste) |
| `GET` | `/api/v1/authorizations/{state}` | admin key | Where an authorization stands |
| `POST` | `/api/v1/authorizations/{state}/complete` | admin key | Finish a paste flow |
| `DELETE` | `/api/v1/accounts/{id}` | admin key | Remove an account |
| `GET` | `/api/health` | none | Liveness probe |

"None" means the app checks nothing — see [Who may open the panel](#who-may-open-the-panel).

## Configuration

| Variable | Default | What it is |
| --- | --- | --- |
| `AI_GATEWAY_API_KEY` | — | Guards every `GET /api/tokens*`, and may read accounts on `/api/v1`. Required |
| `AI_GATEWAY_ADMIN_API_KEY` | — | May also change accounts on `/api/v1`: start and complete an authorization, remove an account. Optional; unset, the REST API is read-only. Set it to the same value as `AI_GATEWAY_API_KEY` to run with one key. Never generated for development |
| `AI_GATEWAY_ENCRYPTION_KEY` | — | 32 base64-encoded bytes; encrypts the stored tokens. Required, and irreplaceable — a new key cannot read the old store |
| `AI_GATEWAY_DATA_DIR` | `.data` | Where `accounts.json` lives. Back this up; it is the pool |
| `AI_GATEWAY_REFRESH_INTERVAL_SECONDS` | `300` | Cadence of the background refresh pass |
| `AI_GATEWAY_USAGE_MIN_INTERVAL_SECONDS` | `180` | Floor between two usage reads for one account; both vendors rate-limit this hard |
| `AI_GATEWAY_TOKEN_REFRESH_SKEW_SECONDS` | `300` | How long before expiry a token is refreshed at the latest; each account's own share of the refresh spread brings it forward |
| `AI_GATEWAY_TOKEN_MIN_HANDOUT_SECONDS` | `3600` | How long a token must still have before its planned refresh to be handed out as available while another account of its vendor can take the work; `0` turns the floor off |
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
| `backend/accounts-api.ts` | The REST door for accounts under `/api/v1`, with its read key and its admin key |
| `backend/account-state.ts` | What state an account is in, and until when it is limited — a pure function of the reading and a clock |
| `backend/gateway.ts` | Composition root; used by `server.ts` and the Vite dev plugin alike |
| `app/` | The panel — one screen, no door, built on `@tale/ui` |

The panel is one screen in the platform's page chrome: an `h-13` header strip
carrying the service's name — set as every platform page title is, in
`AdaptiveHeaderTitle` — and the language / theme / repository cluster, over one
account table built as a list page — the same `useListPage` state Projects and
Automations run on, so it scrolls, loads and counts its rows the way they do. The
rows are ordered vendor, then state, then soonest back (`app/lib/account-order.ts`),
and `backend/account-state.ts` is the one place that decides what state an account
is in — the panel and `/api/v1` both read its answer. Language is a stored
preference here, not a path segment — the panel ships as one untranslated tree — so
the shared `LanguageSwitcher` runs in its state-driven mode.

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
