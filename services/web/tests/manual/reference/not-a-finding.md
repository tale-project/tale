# Not a finding

The registers that keep a round honest: what the marketing site deliberately
does not do, what looks wrong but is correct by design, and what is a known gap
already tracked. **Nothing on these lists is a round finding.** If a box brushes
against one, cite it and move on; if you disagree with an entry, that is a
product conversation, not a bug report.

Everything here is verified against the source. When a round proves an entry
wrong, fix the entry in the same change as the code — a stale quirk costs the
next round a false finding.

**This register starts almost empty on purpose.** It was created on 2026-09-08
with the shared manual-test shape; the guides it replaced had no such list.

## Out of scope

- **Never deliver a test submission through the live forms.** The honeypot-probe
  rule exists so a full pass does not spam the team's Discord — a round that
  submits a real message has broken a rule, not found a bug.

## Product quirks

- <nothing recorded yet>

## Known benign console output

Anything not on this list is a finding, on any page.

- <nothing recorded yet — the first round fills this in>

## Known debt

| ID | What | Pay it off when |
|---|---|---|
| `BL-1` | Form delivery depends on `WEB_DISCORD_WEBHOOK_URL` being set in the deployment; unset, every submission fails with a documented message rather than silently. | the variable is set and `/api/health` reports `checks.forms.ok: true` — see [`R1`](../runs/r0001.md) |
