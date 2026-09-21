# What the automated suites already own

Manual effort is expensive; spend it where a headless run cannot judge. Read
this before hand-verifying anything, and read the seam notes before running any
suite alongside the automated ones — they share one environment.

## Coverage map

One row per area. **Don't** re-verify an `automated` row by hand: a red there is
a spec failure and belongs in the gate, not in a round.

| Area | Owning spec | Manual scope |
|---|---|---|
| The sign-in door | `tests/e2e/specs/smoke.spec.ts` | nothing — the spec renders the card, checks the disabled submit, refuses a wrong password by keyboard and by click, and proves both closed doors answer 401 |
| The two doors' separation | `backend/routes.test.ts` + `tests/e2e/specs/smoke.spec.ts` | nothing — every panel route is asserted to refuse an API-key holder, and the token endpoint to refuse a panel session |
| OAuth URL construction, callback parsing, PKCE | `backend/providers/{anthropic,openai,oauth}.test.ts` | nothing — the authorize URLs, the three paste shapes and the S256 derivation are all asserted |
| Usage-payload mapping (both vendors) | `backend/providers/{anthropic,openai}.test.ts` | how the mapped windows READ in the table — bar widths, the scoped window's vendor name, the reset countdown against the wall clock |
| Token refresh, expiry skew, the usage-poll floor | `backend/accounts.test.ts` | nothing at the unit level — but the live cadence over a real interval is `ACCT-12` |
| Encryption at rest, tamper detection | `backend/crypto.test.ts` | the wrong-key restart's user-visible behaviour (`ACCT-14`) |
| The account document on disk | `backend/store.test.ts` | survival across a real restart (`ACCT-13`) |
| Configuration and the fail-fast boot | `backend/config.test.ts` | nothing |
| **The OAuth round trip itself** | — | **manual-only** — consent happens on a vendor's screen, for an account only its owner has; nothing headless can approve it |
| **Handing a token to the vendor's CLI** | — | **manual-only** — proving `claude` and `codex` actually start on the token needs both CLIs and a live subscription |
| Layout, focus order, theme, narrow viewports | — | **manual-only** — `SMOKE-4` … `SMOKE-9` |

Legend: a named spec owns the row end to end · a named spec **plus** a manual
scope is partial · `—` is manual-only.

## Seams

Anything that makes an automated run and a manual round interfere. Name it here,
and name the direction: which one destroys the other's state, and what the
survivor looks like when it happens.

- `bun run --filter @tale/ai-gateway test:e2e` boots its own dev server on
  :3004. A round already holding that port makes the spec reuse the round's
  server (`reuseExistingServer` outside CI) — which means the spec's wrong-password
  attempts land on the round's gateway. Harmless, but do not read them as a
  round finding; stop the round's server if you want the spec isolated.
- The e2e run writes nothing: every spec stops at the closed door. It cannot
  disturb a round's account document.

## Moving a box here

When a spec takes a box over end to end, **delete the box and add its row here
in the same commit**, naming the spec. A box that survives its automation is
manual effort spent twice; a row that names a deleted spec is worse, so
`bun run lint:manual` rejects a box ID here that no suite defines.
