# The shape of a suite

Copy this file to `suites/<name>.md`, delete this heading block, and fill it in.
Keep the header line, the section order and the box grammar: rounds read suites
side by side, `bun run lint:manual` parses them, and a chauffeur script drives
them.

## Authoring conventions

These are why a suite is executable by a human and by an agent alike.

1. **Declare the prefix in the header blockquote**, directly under the title.
   Every box ID in the file starts with it. Two suites may share a prefix when
   they continue one numbering; no prefix may shadow another. IDs are unique
   across the whole tree, so one is greppable as a single token.
2. **One box, one line of markdown.**
   `- [ ] \`<ID>\` · **<action>** → <what must be true>.` Do the bolded action,
   judge everything after the `→`. Continuation lines are indented two spaces.
3. **Name the route.** Write the URL as the app shows it, with `{param}`
   placeholders — pathless layout segments never appear in a URL.
4. **Name the control by what a user sees**, plus the key that resolves it: the
   **Send** button (`chat.send`). Locate by role + name, never by CSS or guessed
   text — the same rule the automated specs follow.
5. **Every expectation is CHECKABLE**: a URL change, an element or string that
   becomes visible, a value that survives a reload. "Looks right" is not an
   expectation. For a persisted write, judge by reloading and reading the field
   back — never by the transient toast.
6. **State the expectation, not the war story.** If a box is worded oddly
   because something once went wrong, the reason belongs in
   [`reference/pins.md`](reference/pins.md), keyed by box ID.
7. **Append IDs; never renumber.** A box that dies is deleted; its ID is never
   reused. A judgment split out of a crowded box gets a trailing letter
   (`SMOKE-4a`) — part of the ID, not a position.
8. **Never tick a box here.** Ticks live in the session log, findings in
   [`runs/`](runs).
9. **Do not restate what a spec owns.** Check
   [`reference/automation.md`](reference/automation.md) first, and move a box
   there when a spec takes it over.

---

# <Suite name>

> **Prefix** `<PREFIX>-` · **Reset** <when, or none> · **Cost** <wall clock>

<One paragraph: what this suite exercises, who drives it, and what it leaves
behind. If the order of the boxes is a contract — each consuming what its
predecessors left — say so here, in bold, because that is the single most
expensive thing to learn by accident.>

## Preconditions

<What must be true before box one: the state it assumes, the account it runs as,
the feature flag or credential it needs. Link [`../setup.md`](../setup.md)
rather than restating it.>

> **Agent note**: <one line on how to drive this area — what to wait on, and
> what a terminal state looks like. An agent that waits on text instead of
> state is an agent that files flakes.>

## <Group>

- [ ] `<PREFIX>-1` · **<the action>** → <the judgment>.
- [ ] `<PREFIX>-2` · **<the action>** → <the judgment>.
