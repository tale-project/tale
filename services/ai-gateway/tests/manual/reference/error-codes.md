# Error-code provocation map

Which error each surface can produce, and how to reach it deliberately. Used by
the suites when a box says "expect `<code>`", and as the checklist for "should
this code even be reachable from here?".

## Reachable from the UI

Each surfaces as a localized message the user can act on.

| Code | How to reach it |
|---|---|
| `invalid_password` | Sign in with anything but the panel password. |
| `unknown_state` | Complete an authorization twice, or complete one more than 30 minutes after starting it. |
| `missing_code` | Paste something with no `code` in it — a bare `#state`, or prose. |
| `state_mismatch` | Paste a redirect URL whose `state` belongs to a different authorization (start two, swap the pastes). |
| `exchange_failed` | Paste a code the vendor refuses — an expired one, or one already redeemed by its own CLI. |
| `unknown_account` | Remove an account in a second tab, then use the first tab's row menu. |

## Reachable on the API surface only

Never a UI message — seeing one of these in the UI is itself a bug.

| Code | Where it shows up |
|---|---|
| `not_signed_in` | Any `/api/accounts…` or `/api/providers` request without the session cookie. |
| `invalid_api_key` | `GET /api/tokens` with a wrong key, no key, or only a panel session. |
| `invalid_request` | A malformed body: a `provider` the registry does not know, a login with no password, a complete with no paste. The panel's own controls cannot produce these. |
| `unreachable` | Not the server's — the panel's own code for "the fetch never completed". Provoke it by stopping the server and signing in. |

## Must never appear

`internal_error` — the catch-all behind a 500. Every failure this service
expects has a name above; `internal_error` means one did not. There is no
repro by definition, and any sighting is a finding, with the server's own
`[ai-gateway] request failed:` line attached.

## Unreachable from the UI, still enforced

Codes the client-side guards intercept before the server ever answers. **Don't**
file a missing message; **do** confirm the server still refuses, by calling it
directly.

| Code | Guarded by | Proven by |
|---|---|---|
| `invalid_request` (empty password) | **Sign in** stays disabled until the field has a value | `SMOKE-1`, and `backend/routes.test.ts` calls the route with no body |
| `invalid_request` (empty paste) | **Connect** stays disabled until the textarea has a value | `ACCT-6`, and the same suite covers the server's refusal |
| `invalid_request` (unknown provider) | the provider control offers only the registry's own ids | `backend/routes.test.ts` posts `provider: "gemini"` directly |
