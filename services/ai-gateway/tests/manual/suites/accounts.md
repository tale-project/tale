# Accounts

> **Prefix** `ACCT-` · **Reset** before the suite · **Cost** ~30 min

The credential lifecycle, end to end, against the real vendors: add a Claude
account, add a ChatGPT account, watch their tokens stay fresh, hand them to the
CLIs, re-authenticate one, remove one.

This is the suite that cannot be automated. Both flows end in a browser this
service does not control, on a consent screen only a human can approve, for an
account only a human has. Everything below the OAuth round trip — the parsing,
the storage, the refresh arithmetic, the two doors — is already covered by
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
  plan badge, **Active**, and usage bars that are already populated — not
  "No usage read yet".
- [ ] `ACCT-3` · **Add account → OpenAI (ChatGPT) → Continue** → the hint now
  asks for the whole address bar instead, because that flow redirects to a
  loopback URL that will not load.
- [ ] `ACCT-4` · **Approve in the browser, copy the entire failed
  `localhost:1455` address, paste it, Connect** → the row appears the same way,
  with the OpenAI mark and its own plan badge.
- [ ] `ACCT-5` · **Add an account and type a name in step one** → the row
  carries that name, and its caption still shows the provider and the account's
  address, so the identity is not lost behind the label.
- [ ] `ACCT-6` · **Start an authorization, close the dialog, reopen it** →
  step one again, empty: no state, no pasted value and no error survives from
  the abandoned attempt.
- [ ] `ACCT-7` · **Paste the same authorization value a second time** → refused
  with "that authorization expired", not silently accepted into a duplicate row.

### Handing tokens out

- [ ] `ACCT-8` · **Row menu → Copy CLI command on the Claude row, then run the
  clipboard's command in a terminal** → Claude Code starts on that account,
  without asking for a login.
- [ ] `ACCT-9` · **The same on the ChatGPT row** → Codex starts on that account.
- [ ] `ACCT-10` · **`curl localhost:3004/api/tokens -H "Authorization: Bearer
  $AI_GATEWAY_API_KEY"`** → both accounts are listed, each with a token, its
  expiry and the variable its own CLI reads; the two providers sit side by side
  in one answer.
- [ ] `ACCT-11` · **Call the same URL from the signed-in browser tab** → 401:
  a panel session is not a key, and the two doors stay separate.

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
  `GET /api/tokens` no longer carries it.
- [ ] `ACCT-18` · **Remove the last account** → the empty state returns, with
  the create action inside it rather than only in the toolbar.

### Degraded

- [ ] `ACCT-19` · **Stop the network, then reload the panel** → the table shows
  its load failure with a retry, not an empty collection; restore the network
  and Retry recovers without a reload.
- [ ] `ACCT-20` · **Sign in with the wrong password five times in a row** →
  each is refused and named, and the right password still works afterwards.
