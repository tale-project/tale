# Not a finding

The three registers that keep a round honest: what the product deliberately does
not do, what looks wrong but is correct by design, and what is a known gap
already tracked. **Nothing on these lists is a round finding.** If a box brushes
against one, cite it and move on; if you disagree with an entry, that is a
product conversation, not a bug report.

Everything here is verified against the source. When a round proves an entry
wrong, fix the entry in the same change as the code — a stale quirk costs the
next round a false finding.

## Out of scope

Features deliberately excluded, with the reason. An absence nobody wrote down
gets re-filed every round.

- **No inference proxy.** The gateway hands out credentials; it does not sit in
  front of a model. A request to `/v1/chat/completions` 404s on purpose.
- **No account rotation or load balancing.** A token endpoint answers with
  every account it covers and the caller picks. Nothing here counts hand-outs
  or prefers the least-used account.
- **No login on the panel.** No password, no session, no user list, no roles —
  and therefore no sign-in screen to file a finding about. Access is whatever
  fronts the origin; the fleet deployment uses its SSO gateway.
- **No provider beyond Anthropic and OpenAI.** A third is a module and a
  registry line (see the service README), not a configuration setting.
- **No per-account usage history.** Only the latest reading is kept; the bars
  show now, not a trend.

## Product quirks

Intentional behaviours that look surprising but are correct by design.

- **The panel's usage figures can be up to three minutes stale.** Both vendors
  rate-limit their usage endpoint per token hard enough that an unthrottled
  panel poll would spend the budget, so a cached reading is served until it
  ages past `AI_GATEWAY_USAGE_MIN_INTERVAL_SECONDS`.
- **An expired account stays in the list and in `GET /api/tokens`.** It is
  listed with `status: "expired"` so the caller can see what it has rather than
  silently receiving a shorter pool, and so the panel can offer
  **Reauthenticate**.
- **A failed usage read marks the account `error`, not `expired`.** The two mean
  different things: `error` says the last call did not work and the account is
  still being retried; `expired` says the refresh token is spent and only a
  human can fix it.
- **The OpenAI flow sends you to an address that does not load.** The Codex
  OAuth client is registered for `http://localhost:1455/auth/callback`, which
  answers only when Codex itself is listening. The code is in the address bar
  either way, which is what the panel asks for.
- **Development prints four secrets on startup.** They are generated per
  process and never written to disk, so the banner is the only place to read
  them. Production generates nothing and refuses to boot without them.
- **Restarting development invalidates every stored account.** A new
  `AI_GATEWAY_ENCRYPTION_KEY` cannot decrypt what the previous one sealed. Fix
  the four secrets in your environment before a round.

## Known benign console output

Every message a round will see at `warn` or `error` level that is **not** a
defect, with the reason. Anything not on this list is a finding, on any page.

- `[ai-gateway] no inline scripts in dist/index.html; keeping CSP script-src as configured`
  — the shared React server tightens its CSP to the built page's inline-script
  hashes and says so when there are none to hash. Startup only, never in the
  browser.
- `[ai-gateway] usage read failed for … ` / `… refresh failed for …` — the
  server naming a vendor call that did not work, before it marks the account.
  A finding only when the account was expected to be healthy.

## Known debt

Accepted gaps, each with the trigger for paying it off. Cite the `BL-n` and move
on; a round never re-files one.

| ID | What | Pay it off when |
|---|---|---|
| `BL-1` | A plan badge keeps a light surface in dark mode — `Badge`'s colour variants have no dark counterpart in `@tale/ui`. | The shared `Badge` grows dark variants; this panel then inherits them with no change of its own. |
| `BL-2` | The account document is rewritten whole on every change. Fine for the handful of rows a credential pool holds; not a store for thousands. | A deployment ever pools more accounts than a person can read in one screen. |
| `BL-3` | Usage windows are the panel's only view of a plan — nothing is recorded over time, so "was it already at 90% yesterday?" is unanswerable. | Someone needs to see a trend rather than a number. |
