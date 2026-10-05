# Performance (cross-cutting)

> **Prefix** `PERF-` · **Reset** none · **Cost** 20 boxes

Spot-check the load and interaction budgets — cold load to first paint, chat
time-to-first-token (TTFT), thread/route switching, warm-transition prefetch,
list pagination, and the auth-recovery path. None of these are timed by the
e2e suite, so this is a manual / AI-assisted pass.

## Scope & routes

| Surface                | Route                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| Org root (→ chat)      | `/dashboard/{org}`                                                                         |
| Chat input             | `/dashboard/{org}/chat`                                                                    |
| Chat thread            | `/dashboard/{org}/chat/{threadId}`                                                         |
| Email automation inbox | `/dashboard/{org}/automations/outlook__reply-emails` (needs an installed email automation) |
| Contacts DataTable     | `/dashboard/{org}/contacts`                                                                |
| Settings               | `/dashboard/{org}/settings`                                                                |

`/dashboard/{org}` redirects to `/dashboard/{org}/chat`; `/settings` redirects
to `/settings/account`; `/conversations` redirects to the single installed
email automation, else Automations. `{org}` is the 16+ char id in the
dashboard URL.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Decide and
**record three axes** for every number, because each moves it by an order of
magnitude:

- **Mode** — `mockA` (the `lib/mocks` gateway on :4141, deterministic) or
  `live` (a real provider configured in Settings → Providers).
- **Backend** — `local` (the platform's own backend on this machine: the
  process `bun scripts/dev.ts` starts on `:3005` behind the app's proxy, or
  the containers of `docker:dev`) or `hosted` (a deployed instance).
- **Build** — `dev` (the Vite dev server) or `prod` (a production build). For
  `prod` on a local stack, add `TALE_E2E_SERVE_BUILD=1` to the environment of
  mode A's or B's `bun scripts/dev.ts`: it serves `dist/` through
  `vite preview`, which proxies the backend like the dev server, and runs
  `bun --bun vite build` first when `dist/` is missing. Delete `dist/` to
  build again; the build alone needs about 3 GB of memory.

> **Agent / measurement note**:
>
> - The app records a **cold-load trace**, `[cold-load] <label>: <ms>` in the
>   console, for `module-load` (the bundle has run), `router-loaded` (the
>   first route's matches are resolved), `session-resolved` (the session
>   check answered), `member-context` (the membership gate query) and
>   `account-bootstrap` (the 2FA / password-expiry gate query); source:
>   `app/lib/perf/cold-load-trace.ts`. One hard refresh prints all five; the
>   deltas localise the cost (bundle vs. session vs. gate queries). Every mark
>   is also machine-readable: `performance.getEntriesByType('mark')` returns
>   them as `cold-load:<label>` entries, and `getColdLoadTrace()` exposes them
>   to tests/tooling. The dev server always records it; in a **production**
>   build enable it with `localStorage.tale_perf = '1'` then hard-refresh.
> - **The dev server is NOT a perf target.** Under `bun scripts/dev.ts` the
>   first hit on a cold route triggers a Vite transform, so `module-load`
>   alone is multiple seconds (measured 5.5–9.6 s here) and is pure dev
>   tooling, not the product. Treat dev numbers as **relative** (compare
>   deltas / warm-vs-cold) and reserve absolute pass/fail to a **production
>   build** — note which you used.
> - A chat turn reaches a terminal state when the chat input toggles **Stop
>   generating** (`chat.stopGenerating`) back to **Send message**
>   (`chat.send`). Time/await on that toggle, never on streamed text. "TTFT ≈
>   150 ms" describes only the mock gateway's SSE first byte — the **observed
>   turn round-trip** in `mockA` + `local` is far longer (~14 s here) because
>   the Auto classifier hop plus the local self-hosted backend amplify
>   per-query latency ~5–10×.

## Functional / performance tests

- [ ] `PERF-P1` · **Cold load → first paint** — Clear cache, hard-reload
  `/dashboard/{org}`. Watch the console for `[cold-load]` lines. → All five
  `[cold-load]` labels print (`module-load`, `router-loaded`,
  `session-resolved`, `member-context`, `account-bootstrap`); the **Send
  message** button (`chat.send`) becomes visible. Prod build: usable < 3 s
  (`mockA`/`live`, `hosted`). Dev/local: record absolute + note it's dev.
- [ ] `PERF-P2` · **Chat TTFT / turn** — On `/dashboard/{org}/chat` type
  `hello`, click **Send message** (`chat.send`). → **Stop generating**
  (`chat.stopGenerating`) appears, then disappears (turn done) and the URL
  gains `/chat/{threadId}`. Target: prod `live`/`hosted` < 3 s to first token
  (first provider SSE text delta); `mockA`/`local` ≈ 12–18 s round-trip
  (classifier + local amp) — record the number, do not fail it.
- [ ] `PERF-P3` · **Thread switch** — On `/dashboard/{org}/chat/{threadId}`
  open a different thread (a chat row in the Home panel). → URL `{threadId}`
  changes and the message list repaints while the panel stays put. Target:
  warm prod < 1 s; record the dev/local number.
- [ ] `PERF-P4` · **Warm transition** — Hover a left-nav target (e.g.
  **Contacts** in the Knowledge panel), then click it. → URL commits to
  `/dashboard/{org}/contacts`;
  on a warm module cache the route paints without a blocking skeleton
  (row-hover + loader prefetch primed it). Compare cold vs. warm nav delta.
- [ ] `PERF-P5` · **List pagination** — On `/dashboard/{org}/contacts` (or an
  email automation's inbox list) page through when more than one page exists.
  → Each page swap loads the next rows; the page chrome/header does NOT reflow
  or scroll-jump. Target: next page < 1 s warm.
- [ ] `PERF-P6` · **Settings save** — On `/dashboard/{org}/settings/account`
  edit a field; the global save bar appears; click **Save**
  (`common.actions.save`). → The bar shows a saved state; **reload the page
  and read the field back** — the new value persists (assert by reload, not
  the toast). Target: round-trip < 2 s warm.
- [ ] `PERF-P7` · **Auth recovery** — During a cold load, induce a transient
  backend hiccup (restart Convex `:3210` mid-handshake). → The WS reconnects
  and authenticates: the shell finishes painting and chat becomes usable
  WITHOUT a manual reload (no endless skeletons). See
  `cold-start-auth-recovery`. Mark **ENVIRONMENT** if you cannot induce the
  hiccup.
- [ ] `PERF-P8` · **Idle page is silent** — Open `/dashboard/{org}/chat/{threadId}`
  on a thread with no video links, open DevTools → Network (Fetch/XHR), and
  leave the tab untouched for 60 s. → **No** periodic request appears (in
  particular none to `/api/app/video-links/thread/…`); the only open
  connections are the event streams — the organization's hint stream at
  `…/events?orgId=`, `/api/app/chat/threads/{threadId}/stream`, and
  `…/events/file` when `FILE_EVENTS_ENABLED` is on — and nothing periodic.
  Then paste a video URL into the composer → its chip appears within ~1 s
  (the hint stream, not a poll), and while it processes at most one
  `video-links/thread` request every 5 s appears; once it settles, the tab
  is silent again.
- [ ] `PERF-P9` · **Validated reads through the proxy** — From a shell,
  `curl -sS --compressed -D - -o /dev/null` an API list of at least 512 bytes
  through the proxy (e.g. `{SITE_URL}/api/v1/contacts?limit=200` with a
  Bearer key), then repeat it with `-H 'If-None-Match: <the ETag it
  answered>'`. → The first answer carries `Content-Encoding: gzip` or
  `zstd`, `Vary: Accept-Encoding`, an `ETag` ending in `-gzip`/`-zstd` and
  `Cache-Control: private, no-cache`; the repeat answers **304** with no
  body and the unsuffixed `ETag`; the same repeat without `--compressed`
  still answers 304.
- [ ] `PERF-P10` · **Cold /log-in JS budget** — In a brand-new browser
  context (empty cache) open `/log-in`, then read
  `performance.getEntriesByType('resource')` filtered to `.js` → The page
  fetches about **70** script files and **no** `vendor-codemirror-*`,
  `vendor-katex-*` or `vendor-flow-*` chunk (the editor stack, KaTeX and the
  flow canvas stay behind dynamic imports); their `transferSize` sums to at
  most **2.0 MB** (the measured baseline is 1.83 MB gzip, down from
  2.09 MB / 46 files before #4089 and 2.60 MB / 41 files) and the favicon file
  (favicon.ico) transfers under 20 KB. The number to compare against is the `Cold-load JS:` line
  `scripts/check-entry-budget.ts` prints in the build log.

## Response-time SLAs

PERF-P2 above is the per-request **ceiling** a single warm first token (the
first provider SSE text delta, not first painted glyph) should stay under; the
contractual budget is a **mean** over many turns. Two SLAs are tracked
continuously in Prometheus rather than by this manual pass — dialog input at a
~1 s mean and long operations (e.g. evaluations) at a ~40 s mean. The targets,
the recording/alerting rules, and the reconciliation of the ~1 s mean with
this ~3 s ceiling live in the operator guide
(`docs/*/self-hosted/operate/observability/operations.md`, "Response-time
SLAs") and are defined once in `services/platform/sla-targets.ts`. When tuning
PERF-P2 here, confirm the change moves the mean the SLA tracks, not just a
single warm sample.

## Boundary & error tests

- [ ] `PERF-B1` · **Large thread** — Open a chat thread of 300 messages or
  more, scroll it to the top with the wheel or the keyboard, then send a
  message in it. → It opens on its last turn about as fast as a short thread,
  every message in the log: the newest rows render in full, the older ones
  dormant (`data-dormant` on the row, the message's words only) until they
  near the view. Scrolling up reaches every row in full and never jumps the
  rows in view; **Ctrl+F** finds a word of the first message; the send shows
  its first words without a freeze. Under 6,000 DOM elements with the thread
  open; no `pageerror`/console error.
- [ ] `PERF-B2` · **Large list** — A DataTable with hundreds of rows
  (`/contacts`), with no search, filter or sort active. → First page renders
  quickly and only one page of rows is fetched and in the DOM; scrolling
  loads the next page, never the whole set at once. Contacts search is
  server-side: one debounced query uses no more than five list requests and
  matches name, email and external id (plus the server's existing phone match).
  Contacts Name sorting may drain the remaining pages for completeness, but
  its initial rendered window stays bounded and uses the whole column model
  (see [not-a-finding](../reference/not-a-finding.md)).
- [ ] `PERF-B3` · **Slow network** — DevTools throttle to **Slow 3G**,
  hard-reload `/dashboard/{org}`. → Loading skeletons (`aria-busy="true"`
  regions) show during load with NO layout jank; the page eventually renders;
  no crash.
- [ ] `PERF-B4` · **Chat provider error** — Send a message containing
  `e2e:error` in `mockA`. → The provider-error UI renders (HTTP 500 path); the
  chat input recovers to **Send message** enabled — no spinner stuck on, no
  page crash. This is the designed error path (**ENVIRONMENT**).
- [ ] `PERF-B5` · **Database restart** — Keep a tab open on `/dashboard/{org}`
  (DevTools → Network shows its `…/events?orgId=` stream), start a loop that
  calls the REST API twice a second (`while true; do curl -s -o /dev/null -w
  '%{http_code} ' -H 'Authorization: Bearer <key>' {SITE_URL}/api/v1/me;
  sleep 0.5; done`), then run `docker compose restart db` and wait until it
  reports healthy. → The loop prints `200`s, then `503`s while the database is
  away — each a JSON `DATABASE_UNAVAILABLE` with `Retry-After: 5`, never a
  `401` or a `500` — then `200` again. The tab's hint stream stays open
  through the restart (heartbeats keep arriving) and delivers hints again
  afterwards without a reload: edit a task in a second session and watch the
  first one update. `docker inspect --format '{{.RestartCount}}'` on the
  `backend-api` container is unchanged; its log shows `database unavailable`
  warnings and `/events: database back after …` rather than error stacks;
  with `SENTRY_DSN` set no error-level event arrives (a restart longer than
  about a minute sends one warning-level event).
- [ ] `PERF-B6` · **Job queue log through a database restart** — Follow
  `docker compose logs -f backend-worker backend-api`, run `docker compose
  restart db`, and once `db` reports healthy again, restart it a second
  time. → Each restart adds exactly one `pg-boss: database unavailable, polls
  fail quietly until one succeeds: …` warning per container, and no
  `pg-boss error:` dump at all; the second restart adds its own line.
  Afterwards jobs run again: a new chat gets its generated title.
- [ ] `PERF-B7` · **Backend start during a database restart** — Follow
  `docker compose logs -f backend-api`, run `docker compose stop db`, restart
  the api while the database is down (`docker restart $(docker compose ps -q
  backend-api)`) and note its `docker inspect --format '{{.RestartCount}}'`,
  then `docker compose start db` within half a minute. → The api does not
  exit: while the database is away its log shows `[db] transient error on
  attempt …, retrying in …ms: …` lines, and once `db` answers, the boot
  carries on to `api listening on :3005`. The restart count has not moved
  since you noted it, and with `SENTRY_DSN` set no event arrives. Leave `db`
  stopped for more than a minute instead → about a minute after the first
  refusal the api logs one `fatal startup error`, sends one error-level event
  tagged `tale.lane: boot` and exits; Docker starts it again, and that start
  waits another minute.
- [ ] `PERF-B8` · **A write and a list while the app tier is away** — With
  `SENTRY_DSN` pointing at a project you can read, open a project's task
  board, open **Create task** and type a title, then run `docker compose stop
  backend-api`. Click **Create task**, open **All projects** from the Home
  panel, and after about ten seconds run `docker compose start backend-api`.
  → The create fails with one toast, the dialog stays open with the title as
  typed, and no task appears; **Create task** again, once the backend
  answers, creates it once. The projects list shows its error state with
  **Try again** — never an empty list — and fills in on its own within a
  minute of the start, or at once on **Try again**. Neither failure sends an
  event to `SENTRY_DSN`: the edge's `UPSTREAM_UNAVAILABLE` is an operational
  answer, like `DATABASE_UNAVAILABLE` in `PERF-B5`.

## Accessibility (WCAG 2.1 AA)

- [ ] `PERF-A1` · **Loading state** → While a region loads, a `<Skeletonize>`
  wrapper exposes `role="status"` + `aria-busy="true"` + an `aria-label`
  (source: `packages/ui/.../skeleton-context.tsx`); `loading-overlay` exposes
  `role="status"` + `aria-live="polite"`. Verify the attributes are present in
  the DOM during load.
- [ ] `PERF-A2` · **Reduced motion** → With `prefers-reduced-motion: reduce`,
  skeleton shimmer stops: the pulse element carries
  `motion-reduce:animate-none` (source: `packages/ui/.../skeleton.tsx`) so no
  infinite animation runs. Verify via emulated reduced-motion.
