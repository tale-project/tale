# Why a box says that

Each row below is an expectation a suite carries **because something once went
wrong**. The box itself states only the check, so it stays readable; the reason
lives here.

Read this **before you reword, merge or delete a box** — an oddly specific
expectation is usually specific on purpose. Read it too when a box fails and you
want to know what class of defect it was written to catch.

Rows marked `docs` are corrections to this guide rather than to the product: the
box used to ask for something unreachable or wrong, and a round proved it. They
stay so nobody re-introduces the old wording.

**Adding a row:** when a round sharpens a box, add the row here in the same
change as the box edit. Key it by box ID, state the mechanism (not the symptom),
and name the test that now holds it. Never key a row by round — the journal in
[`../runs`](../runs) records rounds, this register records product knowledge.

## Smoke

| Box | What it pins |
|---|---|
| `SMOKE-10` | The panel keeps no door of its own. It once had a password and a signed session cookie in front of the same screen the fleet's SSO gateway already guards, so every operator signed in twice. Both went; whatever fronts the origin is the only gate, and a deployment that puts nothing there exposes the pool. |
| `SMOKE-4` | French punctuation spacing survives the catalog. The `%` in a usage bar takes a nonbreaking space before it, and an editor that retypes the line loses it silently — the character is invisible. |
| `SMOKE-6` | The row action menu is the only route to three of this panel's four verbs. A toolbar that is reachable but a menu that is not leaves a keyboard user unable to copy a command, re-authenticate or remove. |
| `SMOKE-11` | The strip is the documentation frame's header row, not a second design. Its own border IS the line under it: wrapping a fixed-height row in a bordered parent puts the border outside the height and ends the strip a pixel low. The box asks for the height and the single line for that reason. |
| `SMOKE-13` | The table frame stretches to its bounded height (`DataTable fillHeight`). Without it a one-row result left the count footer high on the page with a screen of empty background under it — this screen is nothing but its table, so the frame is the screen. |
| `SMOKE-15` | Colour alone is not a status (WCAG 1.4.1), and below `md` the label does not fit. The glyph is what carries the state at every width; the label is hidden, never removed, so the accessible name is the same on a phone as on a desktop. |
| `SMOKE-14` | The panel's only landmark used to be the table. A page with no `<main>` gives a screen-reader user nothing to jump to, and the skip link has to move focus itself — a fragment navigation only scrolls in some browsers. |

## Accounts

| Box | What it pins |
|---|---|
| `ACCT-2` | A freshly connected account pulls its first usage reading immediately, rather than waiting for the background pass. Without that forced first read the row arrived with empty bars and read as broken. |
| `ACCT-5` | The row caption carries the provider name and the address even when the label is custom. Defaulting the label to the address once made the caption repeat it word for word, which is how the caption came to be conditional. |
| `ACCT-6` | Closing the dialog discards the attempt. The reset lives in the close handler, not in an effect on `open` — an effect fired a second render on every open and made the provider control flicker through the previous row's value. |
| `ACCT-7` | A pending authorization is consumed by the read that finds it, so a replayed paste cannot mint a second account from one consent. |
| `ACCT-21` | The API key guards the token endpoints and nothing else. Its predecessor — the panel's session guard — was once a wildcard middleware over `/api/*`, which silently swallowed `/api/tokens` as well and answered 401 to a correct key. Every gate here is applied per route for that reason. |
| `ACCT-24` | An empty pool is `{"tokens": []}` and an unknown vendor is a 404. Collapsing the two would leave a caller unable to tell a gateway holding no ChatGPT accounts from one that never heard of the vendor — the first is waiting for someone to add an account, the second is a misconfigured URL. |
| `ACCT-12` | Reset countdowns are computed from an absolute instant. A vendor that reports `resets_in_seconds` rather than `resets_at` is converted at read time; keeping the relative figure made every countdown drift by the reader's UTC offset. |
| `ACCT-14` | A store that cannot be decrypted fails loudly. AES-256-GCM's authentication tag is what makes a wrong key an error rather than plausible garbage. |
| `ACCT-18` | `docs` — the box used to ask for the create action inside the empty state. The shared list pattern moves it there only when no toolbar chrome needs to stay visible, and this screen always renders its search box, so the button correctly stays in the toolbar. |
| `ACCT-27` | The order is grouped, not alphabetical. An operator opens this screen to judge one vendor's pool; interleaving the two vendors by name makes that a scan instead of a glance. Sorting on the address rather than the label keeps a renamed account where its e-mail puts it. |
| `ACCT-25` | A usage bar is a quota, not a progress bar. The shared `ProgressBar` paints a full bar green — "done" — which on a spent plan says the opposite of what happened; the panel tints it from the same three tokens the platform's usage meter uses. |
