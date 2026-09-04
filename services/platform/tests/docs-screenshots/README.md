# Docs screenshot pipeline

Every image under `services/docs/public/images/` is produced by this pipeline from the declarative
manifest in [`manifest.ts`](manifest.ts) — no hand-captured screenshot ever ships. The doctrine
lives in the `write-docs` skill (`builtin-configs/skills/write-docs/SCREENSHOTS.md`); the Tale
repo facts in [`docs/AGENTS.md`](../../../../docs/AGENTS.md); the gate in
`services/docs/tests/image-manifest.test.ts`.

## Runbook — clean checkout → all screenshots

```bash
# 0. Once per machine
bun install
bunx playwright install chromium

# 1. Terminal 1 — mock gateway (chat SSE + AI + connector mocks) on :4141
cd services/platform && bun lib/mocks/start.ts

# 2. Terminal 2 — platform dev stack (app on :3000), hermetic, seeded from the
#    docs-demo catalog (the REAL builtin agents/prompts/workflows via symlinks;
#    the seed itself wires the mock AI provider so chat answers offline)
cd services/platform && \
  TALE_DEV_SKIP_DOCKER=1 \
  TALE_DEV_OPEN=0 \
  TALE_CONFIG_DIR="$(pwd)/tests/e2e/fixtures/config" \
  TALE_CONFIG_BUILTIN_DIR="$(pwd)/tests/e2e/fixtures/config/docs-demo" \
  TALE_PROVIDER_KEY_E2E_MOCK=tale-e2e-mock-key \
  TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 \
  TALE_MOCK_CONNECTORS_BASE=http://127.0.0.1:4141 \
  bun scripts/dev.ts
# wait for the READY banner

# 3. Terminal 3 — bootstrap the demo org, seed content, capture
#    (from the REPO ROOT — `docs:screenshots` is a root package.json script)
bun run docs:screenshots                          # everything
bun run docs:screenshots -- --list                # enumerate shots
bun run docs:screenshots -- --only chat-composer  # regenerate one
bun run docs:screenshots -- --grep '^governance-' # a section
bun run docs:screenshots -- --skip-seed           # reuse seeded content as-is

# 4. Verify + eyeball
bun run --filter @tale/docs test                  # images + manifest checks
bun run --filter @tale/docs dev                   # docs on :3002
```

## How it works

1. **Preflight** — the runner never boots the stack; it probes :4141 and :3000 and prints the
   bring-up commands when either is down.
2. **Bootstrap** — first run signs up the demo owner (`demo-content.ts`) via in-page fetch
   (Playwright's `APIRequestContext` crashes parsing Set-Cookie under Bun — never use it for
   auth), drives the create-org wizard to mint **Northlight Labs**, and persists
   `storageState` + org id under `.state/` (gitignored). Later runs reuse it; delete `.state/`
   to mint a fresh workspace.
3. **Seed** — `seed-demo-org.ts` creates the believable content through the real UI,
   check-then-create idempotent: projects with tasks, knowledge documents, and chats whose
   prompts are answered by the scripted markdown replies in
   `lib/mocks/overrides/docs-replies.ts` (reasoning included, so "Thinking" captures need no
   `e2e:` trigger in the visible message). The mock provider and the org's **embedding model**
   (Settings > Data residency, pointed at the mock's `/v1/embeddings`) are wired before the
   first upload — knowledge indexing refuses every file until one exists — and rows an earlier
   run left `Failed` are re-queued through their own Retry indexing button.
4. **Capture** — per shot: fresh context at 1440×900, DPR 2, light theme + `en` locale forced
   via `localStorage` init script, reduced motion; navigate, run `prepare`, wait on the
   `readyWhen` locator (never on time), screenshot the `capture` element or the viewport,
   encode WebP down a quality ladder to < 190 KB (`webp.ts` — an over-budget shot means crop
   tighter), write `services/docs/public/images/<section>/<name>.webp`.
5. **Manifest** — upserts `services/docs/public/images/manifest.json` (committed, generated,
   diff-quiet: stable sort, no timestamps). The docs test suite fails any on-disk image that is
   not declared here.

## Gotchas

- **Ports 3000/4141 must be owned by THIS stack.** If another dev stack holds :3000, its config
  dir seeds the orgs and nothing here works (`waitForSeededOrg`'s error explains the same trap).
  Override the app origin with `E2E_BASE_URL`, the gateway with `TALE_MOCK_CONNECTORS_BASE`.
- **`TALE_CONFIG_BUILTIN_DIR` must point at `docs-demo/`** — without it, wizard orgs seed from
  the real `builtin-configs/` (OpenRouter with no key) and chat is dead.
- **Mock provider wiring is a SEED stage** (post-credentials-rewrite): `ensureMockProvider`
  copies `docs-demo/providers/e2e-mock.yml` (an org-custom provider, `baseUrl` →
  `http://127.0.0.1:4141/v1`) into the demo org's config dir and connects an env credential
  named `TALE_PROVIDER_KEY_E2E_MOCK` through the settings UI. The gateway's `/v1/models`
  serves a believable catalog and its completions echo any model id, so the picker looks real.
- **`TALE_DEV_SKIP_DOCKER=1` only skips bringing the Docker services up** — the backend still
  dials the knowledge-db on `localhost:5433`. With the containers already running (a `bun dev`
  from the main checkout starts them) indexing works; with none, uploaded documents eventually
  show a `Failed` indexing badge. For knowledge-page captures where the badge is in frame, have
  the containers running (or boot WITHOUT the flag) and re-run only those shots — the seeder
  retries the `Failed` rows.
- **Adding a shot** = one entry in `manifest.ts` (locators through `t()`, readiness on state,
  element crops for detail shots) + the page embedding it + the captured `.webp` + regenerated
  `manifest.json`, all in the same change. When a PR changes a route, grep `manifest.ts` for it
  and regenerate the affected shots.
