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

- `The width(-1) and height(-1) of chart should be greater than 0` (warn,
  several per page) on every metrics page that draws a chart — Settings →
  Metrics → Usage, Projects with a picked project, and the others once they
  have data. Recharts' responsive container logs it on its first measure
  before the card has a size; the chart paints on the next frame. Benign.
- A tab kept open across a deploy (`NAV-B13`, any page — the box uses
  `/dashboard/{org}/documents`): the browser's own `Failed to load module
  script: Expected a JavaScript-or-Wasm module script but the server responded
  with a MIME type of "text/html"` for the previous build's chunk, which the
  deploy removed (the server answers the app shell). While that tab reloads
  onto the new build, the lazy load the recovery swallowed can log `TypeError:
  Cannot read properties of undefined (reading 'default')` (or of a preview
  component's name); during a server restart the same fallout reads `Service
  worker registration failed TypeError: Cannot destructure property 'Workbox'
  of 'undefined'`. None of it reaches the error reporter
  (`isStaleBundleFallout` in `app/lib/stale-bundle-recovery.tsx`). A `Failed to
  fetch dynamically imported module` shown together with the **A new version
  is available** toast is different: it is the real error of a chunk that
  failed again after its reload, and it is reported.

## Known debt

Accepted gaps, each with the trigger for paying it off. Cite the `BL-n` and move
on; a round never re-files one.

| ID | What | Pay it off when |
|---|---|---|
| `BL-1` | Five `chat-*` specs and the `automations`, `email-automation` and `knowledge` specs were retired in #2857 with no successor, so those areas are manual-only. | a successor spec is authored — then the rows move to [`automation.md`](automation.md) |
| `BL-2` | Two runs of one project agent share its standing `pa-<agentId>` session, and every exec there runs as the same `agent` user, so one run's process can read another's turn token (from its argv where the harness passes the MCP config as a flag, or from its environment, where every managed harness already holds the same token as its model key). While the other run is live, a connector call made with it acts for that run's starter (TASK-F36, TASK-B10). The token stops acting for anyone the moment its run ends (`run_ended`), and it never carried more grants than the agent's own. | runs of one agent get their own session or user, or the sandbox isolates execs from each other |
| `BL-3` | A waiting review that an erasure from before #3554 stamped with the pseudonym still waits on nobody: its chip names no one, it is on nobody's **Needs my review** and in no bell. No backfill was shipped: the reviewer chain checks membership and project access in code, so a SQL repair would be a second copy of it. Recovery on such a task: set **Reviewer** (`tasks.fields.reviewer`) — the open review moves to that person — and clear it again to hand it to the task creator. | the first report of such a task — then a one-shot repair runs `retargetPendingTaskReview` over the pending, workflow-free `task_review` rows whose `requestedFor` is `erased-user` |
| `BL-4` | A settings field row's help is announced on focus only through a control that points at it: the row puts `aria-labelledby` / `aria-describedby` on its wrapper, a plain `div` whose name and description assistive tech ignores. On a project's General page the **Name**, **Description** and **Audience** controls take the row's label and help through `SettingsFieldRow`'s function child (PROJ-A7); the other `SettingsFieldRow` controls (governance, organization, SSO, data residency, skills, …) do not yet, so Tab lands on them without the help being read. This records the missing focus-time help association, not a conformance judgment for every screen: a missing control name, essential instruction or programmatic relationship remains reportable. | a screen with settings field rows is next touched — wire its controls the same way; once every row's control is wired, drop the wrapper's two attributes |
| `BL-5` | An accent's text shade (`--primary`, `--ring`, the accent context) is walked to 4.5:1 against the theme's `--background` and a tint of itself only (`deriveAccentText` in `lib/utils/color.ts`, whose docstring measures the rest). On the dark theme's lighter grays it can read below that: over `--accent` (`#2b2b2b`, the gray hover) `#0066CC` reads 4.12:1, `#0B0B2A` 4.18:1 and `#443366` 4.21:1, with a worst case near 3.8:1; over `--muted` it reads down to about 4.0:1, and beneath a tint on `--card` to about 3.9:1. On the page, accent text can hover on its own tint (`hover:bg-primary/10`); on a lighter container, even that tint can fail, so choose ink that clears contrast on the actual surface. This records the palette’s limits, not an accessibility exemption: insufficient text, icon or focus contrast on any rendered surface remains a finding, including a tint over a lighter container. | a design call to judge the dark walk against a lighter surface (against `--accent`, most dark text shades would lift by 8 to 19 lightness points), then `deriveAccentText` and `color.test.ts` change together |
| `BL-6` | A near-white pick keeps its hue on the light theme, so it turns muddy there: `#F5F5F0` fills primary buttons in the olive `#909060` and sets accent text in `#626241`, its own hue darkened until it clears 3:1 and 4.5:1 on the page (SET-F28a). Tale does not fall back to a neutral for a pick with almost no colour. | a design call on near-neutral picks (for example, dropping the saturation of a pick below a chroma threshold), made in `adjustColorForTheme` with a case in `color.test.ts` |
