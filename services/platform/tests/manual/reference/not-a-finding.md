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

- **A wizard-created org in mode A is not provider-wired.** It lands on chat's
  **No AI provider connected yet** empty state with zero credentials; add the
  mock provider under Settings → AI providers, or mint the org through
  `save-auth-state.ts`. Observed live 2026-08-04.
- **"Tale is ready to work offline." fires once on first service-worker
  install.** Benign, and it will photobomb an unrelated screenshot.

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
