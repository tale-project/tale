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

- <not built, and why>

## Product quirks

Intentional behaviours that look surprising but are correct by design.

- <the behaviour, then the mechanism that makes it correct>

## Known benign console output

Every message a round will see at `warn` or `error` level that is **not** a
defect, with the reason. Anything not on this list is a finding, on any page.

- <the exact message> — <where it comes from, and why it is benign>

## Known debt

Accepted gaps, each with the trigger for paying it off. Cite the `BL-n` and move
on; a round never re-files one.

| ID | What | Pay it off when |
|---|---|---|
| `BL-1` | <the gap> | <the trigger> |
