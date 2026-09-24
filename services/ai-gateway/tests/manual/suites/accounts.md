# Accounts

> **Prefix** `ACCT-` · **Reset** before the suite · **Cost** ~30 min

The credential lifecycle, end to end, against the real vendors: add a Claude
account, add a ChatGPT account, watch their tokens stay fresh, hand them to the
CLIs, re-authenticate one, remove one.

This is the suite that cannot be automated. Both flows end in a browser this
service does not control, on a consent screen only a human can approve, for an
account only a human has. Everything below the OAuth round trip — the parsing,
the storage, the refresh arithmetic, the API key — is already covered by
specs; see [`../reference/automation.md`](../reference/automation.md).

## Preconditions

- The dev server up on :3004 per [`../setup.md`](../setup.md), with **fixed**
  secrets in the environment — a generated `AI_GATEWAY_ENCRYPTION_KEY` changes
  on every restart and cannot read what the previous run sealed.
- A **Claude Pro or Max** account and a **ChatGPT Plus or Pro** account you own,
  signed in in this browser.
- A terminal with `claude` and `codex` on the path, for the hand-out boxes.
- `AI_GATEWAY_DATA_DIR` pointing at a scratch directory, emptied before the
  suite (see [reset](../setup.md#reset-choreography)).

## Boxes

### Adding an account

- [ ] `ACCT-1` · **Add account → Anthropic (Claude) → Continue** → step two
  names the Anthropic authorization URL, and its hint asks for the code the
  page prints.
- [ ] `ACCT-2` · **Open that URL, approve, copy the value the console page
  shows, paste it, Connect** → the dialog closes, a toast names the account,
  and a row appears carrying the Claude mark, the account's own e-mail, its
  plan in the Plan column, **Active**, and usage bars that are already
  populated — not "No usage read yet".
- [ ] `ACCT-3` · **Add account → OpenAI (ChatGPT) → Continue** → the hint now
  asks for the whole address bar instead, because that flow redirects to a
  loopback URL that will not load.
- [ ] `ACCT-4` · **Approve in the browser, copy the entire failed
  `localhost:1455` address, paste it, Connect** → the row appears the same way,
  with the OpenAI mark, its own plan and populated usage bars. Every
  ChatGPT plan publishes at least its weekly window, so "No usage read yet" on
  a freshly connected OpenAI row is a defect, not an empty plan.
- [ ] `ACCT-5` · **Add an account and type a name in step one** → the row
  carries that name, and its caption still shows the provider and the account's
  address, so the identity is not lost behind the label.
- [ ] `ACCT-6` · **Start an authorization, close the dialog, reopen it** →
  step one again, empty: no state, no pasted value and no error survives from
  the abandoned attempt.
- [ ] `ACCT-7` · **Paste the same authorization value a second time** → refused
  with "that authorization expired", not silently accepted into a duplicate row.
- [ ] `ACCT-33` · **Add account → open the Provider picker** → each vendor is
  listed with its own mark beside its name — the mark its rows carry in the
  table — and the closed picker keeps the chosen vendor's mark. A screen
  reader still hears only the vendor's name.

### Handing tokens out

- [ ] `ACCT-8` · **Row menu → Copy CLI command on the Claude row, then run the
  clipboard's command in a terminal** → Claude Code starts on that account,
  without asking for a login.
- [ ] `ACCT-9` · **The same on the ChatGPT row** → Codex starts on that account.
- [ ] `ACCT-10` · **`curl localhost:3004/api/tokens -H "Authorization: Bearer
  $AI_GATEWAY_API_KEY"`** → both accounts sit side by side in one answer, each
  with `access_token`, `expires_at` and the `provider` that says whose it is.

### One vendor at a time

The split endpoints exist so a caller pointed at one vendor cannot be handed
the other's credential — and the answer is cc-gateway's own shape, so anything
written against that service reads this one. **These boxes need both accounts
in the pool**, so they run before the removals.

- [ ] `ACCT-21` · **`curl localhost:3004/api/tokens/anthropic -H
  "Authorization: Bearer $AI_GATEWAY_API_KEY"`** → only the Claude row comes
  back, carrying cc-gateway's own field names — `id`, `label`,
  `account_email`, `status`, `access_token`, `expires_at`, `scopes` — and no
  `provider`. The ChatGPT token appears nowhere in the body.
- [ ] `ACCT-22` · **Run `ANTHROPIC_AUTH_TOKEN=<access_token> claude` with the
  `access_token` that answer carried** → Claude Code starts on that account
  without asking for a login. The endpoint's token is the CLI's token.
- [ ] `ACCT-23` · **The same two steps against `/api/tokens/openai`, then
  `CODEX_ACCESS_TOKEN=<access_token> codex`** → only the ChatGPT row, and
  Codex starts on it.

### Finding an account

- [ ] `ACCT-27` · **Read the row order with both vendors in the pool** → every
  Claude account first, then every ChatGPT one, and inside each vendor the
  rows in order of the address rather than the label. A renamed account sits
  where its e-mail puts it, not where its name would.
- [ ] `ACCT-28` · **Filter → Provider → one vendor** → only that vendor's rows,
  and the count footer agrees. Add a Status facet on top and the two narrow
  together; **Clear all** puts every row back.
- [ ] `ACCT-29` · **Filter down to nothing** → the no-results state, with the
  search and the filter button still reachable so the reader can undo it.

### Reading a plan at a glance

- [ ] `ACCT-34` · **Read the Plan column with a Claude and a ChatGPT account in
  the pool** → each row names the plan its vendor sells it as — "Max 20x",
  "Max 5x", "Pro", "Plus", "Pro Lite" — and never an organization's name. The
  names read the same in every language. A row whose plan has not been read
  yet shows a dash, and a screen reader hears "Not read yet" for it.

- [ ] `ACCT-25` · **Find an account whose session window is under three
  quarters spent, one at or past three quarters, and one at the ceiling** →
  the three bars read accent, orange and red in that order. A full bar never
  reads as green: a spent plan is not a completed task.
- [ ] `ACCT-26` · **Hover a usage bar, then the grey bar beside it** → the
  first names the percentage, the second the exact instant that window
  resets — the date and the hour, in the panel's language, and the instant the
  row's own figure is counting down to.
- [ ] `ACCT-30` · **Read the Resets in column without touching the mouse** →
  every window says how long it still has ("5 days", "an hour") on the same row
  as its own usage bar, and never in a different order than the Usage column
  lists them. The two Anthropic windows that roll over together say the same
  thing.
- [ ] `ACCT-31` · **Compare the two bars on one row** → the grey one fills
  toward the rollover the way the coloured one fills toward the cap, so an
  account spending its plan faster than the clock reads as a coloured bar ahead
  of its grey one. A window the vendor gave no rollover for leaves the grey
  track empty rather than drawing a fraction of nothing.
- [ ] `ACCT-32` · **Read the Resets in column in each language** → the heading
  and the figure agree grammatically in all three: the English heading finishes
  in the cell ("Resets in" · "5 days"), and the German and French headings name
  the time remaining instead, because a bare German distance is nominative and
  will not sit behind a preposition.

### Staying fresh

- [ ] `ACCT-12` · **Leave the panel open past the refresh interval** → the
  usage figures move on their own, and the reset countdowns stay consistent
  with the wall clock rather than drifting by your UTC offset (`ACCT-12`).
- [ ] `ACCT-13` · **Restart the server with the same secrets and reload** →
  both accounts are still there, still Active: the document on disk survived,
  and the stored tokens decrypt.
- [ ] `ACCT-14` · **Restart the server with a different
  `AI_GATEWAY_ENCRYPTION_KEY` and reload** → the panel does not pretend: the
  rows show a failure rather than empty usage bars, and nothing crashes the
  process.
- [ ] `ACCT-15` · **Row menu → Reauthenticate on one row, complete the flow** →
  the same row is updated in place; the pool does not grow, and the account's
  usage history stays with it.

### Removing

- [ ] `ACCT-16` · **Row menu → Remove, then cancel the confirmation** → the row
  is still there and the token endpoint still hands it out.
- [ ] `ACCT-17` · **Remove and confirm** → the row goes, a toast names it, and
  neither `GET /api/tokens` nor that vendor's own endpoint carries it.
- [ ] `ACCT-18` · **Remove the last account** → the empty state returns, headed
  by its key glyph, and the table frame shrinks to fit it rather than framing
  the copy in an empty screen. **Add account** stays in the toolbar: the search
  box is still there, and the shared list pattern only moves the create action
  into the empty body when no toolbar needs to remain visible.
- [ ] `ACCT-24` · **With the pool now empty, call `/api/tokens/openai`** → 200
  with `{"tokens": []}`. An empty pool is an empty list, never a 404 — a
  caller must be able to tell "no accounts" from "no such vendor".

### Degraded

- [ ] `ACCT-19` · **Stop the network, then reload the panel** → the table shows
  its load failure with a retry, not an empty collection; restore the network
  and Retry recovers without a reload.
