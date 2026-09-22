# Not a finding

The registers that keep a round honest: what the platform deliberately does not
do, what looks wrong but is correct by design, and what is a known gap already
tracked. **Nothing on these lists is a round finding.** If a box brushes against
one, cite it and move on; if you disagree with an entry, that is a product
conversation, not a bug report.

Everything here is verified against the source. When a round proves an entry
wrong, fix the entry in the same change as the code — a stale quirk costs the
next round a false finding.

**This register starts almost empty on purpose.** It was created on 2026-09-08
with the shared manual-test shape; the guides it replaced had no such list, so
every quirk they had learned was still living inside a box's wording. Move one
here the first time a round re-files it.

## Out of scope

- **The mock-gateway stack is not the product.** Anything that only reproduces
  in mode A because a canned reply is canned belongs here, not in a finding —
  say which mode a round ran in ([setup.md](../setup.md)).

## Product quirks

- **A secret field is a `type="text"` input masked with CSS, not a
  `type="password"` control.** API-key and token fields (`sensitive` on
  `@tale/ui` `Input`) render `type="text"` with `-webkit-text-security: disc`,
  `autocomplete="off"` and the password-manager opt-outs, so Chrome's saved-
  password dropdown and "suggest strong password" stay away from a field that
  is not a password (#1912; locked by `input.test.tsx` and the `Input` guide).
  The accessibility tree therefore exposes the typed value as a plain
  textbox — a property of any text control, not a leak: stored secrets are
  never echoed into the field. Report it only if a round finds a stored value
  rendered into the field.
- **A client-side search, filter or sort on a paginated list drains every
  page.** The contacts table (and every `useListPage` list) fetches one page
  at rest, but a search box, facet or sort that is evaluated client-side
  intentionally loads the remaining pages so the result is complete (#2054) —
  eleven list responses after typing a query are that drain, not eager
  paging. PERF-B2 measures the resting page only.
- **A wizard-created org in mode A is not provider-wired.** It lands on chat's
  **No AI provider connected yet** empty state with zero credentials; add the
  mock provider under Settings → AI providers, or mint the org through
  `save-auth-state.ts`. Observed live 2026-08-04.
- **"Tale is ready to work offline." fires once on first service-worker
  install.** Benign, and it will photobomb an unrelated screenshot.
- **A chunked body past a route's cap is read to the cap before the 413.** A
  JSON write sent with `Transfer-Encoding: chunked` and no `Content-Length`
  cannot be refused before a byte arrives: the door counts the chunks as they
  land and stops at the first one past the cap (`readBodyBytes`,
  `backend/rest/shared.ts`), answering the same 413 `BODY_TOO_LARGE` a
  declared length gets before any byte is read. A client streaming 1.14 MB at
  the 1 MiB cap therefore sees its whole upload go out first — the bytes in
  flight on the connection drain, the platform does not read past the cap —
  and a slower refusal than the declared-length path. A `Connection: close`
  the platform added would not survive the edge, which strips hop-by-hop
  headers. Observed live in the 2026-09-13 round-e API evaluation (E5-03).
- **`curl -H 'Idempotency-Key:'` sends no header at all.** curl drops a `-H`
  whose value is empty, so a probe that seems to send a blank key sends none
  and the door answers as if no key was given; the blank-key refusal (400
  `INVALID_HEADER`) is reachable only with the semicolon form
  (`-H 'Idempotency-Key;'`), which sends an empty value. Observed in the
  2026-09-14 round-h API evaluation (h1).

## Known benign console output

Every message a round will see at `warn` or `error` level that is **not** a
defect, with the reason. Anything not on this list is a finding, on any page.

- <nothing recorded yet — the first round fills this in, and every entry names
  the page it came from>

## Known debt

Accepted gaps, each with the trigger for paying it off. Cite the `BL-n` and move
on; a round never re-files one.

| ID | What | Pay it off when |
|---|---|---|
| `BL-1` | Five `chat-*` specs and the `automations`, `email-automation` and `knowledge` specs were retired in #2857 with no successor, so those areas are manual-only. | a successor spec is authored — then the rows move to [`automation.md`](automation.md) |
