# Error-code provocation map

Which error each surface can produce, and how to reach it deliberately. Used by
the suites when a box says "expect `<code>`", and as the checklist for "should
this code even be reachable from here?".

## Reachable from the UI

Each surfaces as a localized message the user can act on.

| Code | How to reach it |
|---|---|
| `unknown_state` | Complete an authorization twice, or complete one more than 30 minutes after starting it. |
| `missing_code` | Paste something with no `code` in it — a bare `#state`, or prose. |
| `state_mismatch` | Paste a redirect URL whose `state` belongs to a different authorization (start two, swap the pastes). |
| `exchange_failed` | Paste a code the vendor refuses — an expired one, or one already redeemed by its own CLI. |
| `expired` | Leave a device code unapproved for fifteen minutes (`ACCT-42`). |
| `denied` | Decline at the vendor — at Anthropic on a loopback panel (`ACCT-40`), or refuse the code at OpenAI. |
| `unavailable` | Start an OpenAI sign-in while `auth.openai.com` is unreachable (block it in `/etc/hosts`); the gateway answers 502. |
| `unknown_account` | Remove an account in a second tab, then use the first tab's row menu. |
| `signed_out` | Not the server's — the panel's own code for a redirect, or a 401 without the gateway's envelope, from whatever fronts it: its sign-in ran out. On the fleet's panel, delete the SSO gateway's `__Host-tale_entra_oid*` cookies and wait for the next re-read (`ACCT-46`), or use a row action. |
| `unreachable` | Not the server's — the panel's own code for "the fetch never completed". Block `/api/accounts` in the browser's developer tools and reload the panel for the table's failure state (`ACCT-19`), or stop the server with the panel open for the warning above the rows (`ACCT-45`). |

## Reachable on the API surface only

Never a UI message — seeing one of these in the UI is itself a bug.

| Code | Where it shows up |
|---|---|
| `invalid_api_key` | Any `GET /api/tokens…` with a wrong key or no key. The panel's routes never answer this — the key is not their door. |
| `unknown_provider` | `GET /api/tokens/<anything the registry does not know>` with a valid key — `/api/tokens/gemini`. A vendor that exists but holds no accounts is a 200 and an empty list instead. |
| `invalid_request` | A malformed body: a `provider` the registry does not know, a complete with no paste. The panel's own controls cannot produce these. |

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
| `invalid_request` (empty paste) | **Connect** stays disabled until the textarea has a value | `ACCT-6`, and the same suite covers the server's refusal |
| `invalid_request` (unknown provider) | the provider control offers only the registry's own ids | `backend/routes.test.ts` posts `provider: "gemini"` directly |
