# Capture documentation screenshots

The screenshot runner drives the real platform with synthetic demo content and a mock model gateway.
It produces the WebP files under `services/docs/public/images/` and their generated manifest. Add or
change a shot in [`manifest.ts`](manifest.ts); never hand-edit a screenshot to imply product behavior.

Read the [screenshot guide](../../../../.agents/skills/write-docs/SCREENSHOTS.md) for framing and
[docs contract](../../../../docs/AGENTS.md) for embedding images and translating captions.

## Prepare a local platform

Use a disposable development environment. The seeder creates an organization, documents, tasks,
skills, credentials, and governance examples; do not point it at a customer deployment or a
database whose contents you need to preserve.

From the repository root, install dependencies and Chromium:

```bash
bun install --frozen-lockfile
bunx playwright install chromium
```

You need Bun, Node.js, Docker with Compose, and the backing services described in the
[platform README](../../README.md). The screenshot runner does not start them.

Start the mock gateway in one terminal:

```bash
cd services/platform
bun lib/mocks/start.ts
```

Start the platform in another terminal, from the same checkout:

```bash
cd services/platform
TALE_DEV_OPEN=0 \
  TALE_E2E=1 \
  TALE_CONFIG_DIR="$(pwd)/tests/e2e/fixtures/config" \
  TALE_CONFIG_BUILTIN_DIR="$(pwd)/tests/e2e/fixtures/config/docs-demo" \
  TALE_PROVIDER_KEY_E2E_MOCK=tale-e2e-mock-key \
  TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 \
  TALE_MOCK_CONNECTORS_BASE=http://127.0.0.1:4141 \
  bun scripts/dev.ts
```

Wait for the ready banner. The application runs on port 3000, its backend on 3005, and the mock
gateway on 4141. `TALE_E2E=1` skips the external toolchains; it does not replace the database or object
store with mocks.

### Use backing services you have already started

Set `TALE_DEV_SKIP_DOCKER=1` only when the required services are already available. It skips Docker
startup, not database, storage, or indexing work. Set both `DATABASE_URL` and
`KNOWLEDGE_DATABASE_URL` when your database ports differ from the defaults. The application and
knowledge databases have separate schemas; an ordinary empty Postgres database does not include
the knowledge corpus service's migrations and extensions.

For an isolated test stack using the repository's database image, you can expose `tale_app` and
`tale_knowledge` on port 5547 and the object store on port 59000. These are example ports,
not a requirement. Use the image version selected by your checkout and its documented initialization
rather than relying on `POSTGRES_DB` to name every database it creates.

Configure a reachable S3-compatible object store before starting the backend. The dev orchestrator
supplies local defaults for `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_BUCKET`,
`OBJECT_STORE_ACCESS_KEY`, and `OBJECT_STORE_SECRET_KEY`; explicit environment values take
precedence. Those values must match your store. If the backend started before storage was ready,
restart the task's dev process and retry the upload. Do not restart an unrelated checkout's stack.

## Capture and review

Run these commands from the repository root:

```bash
bun run docs:screenshots -- --list
bun run docs:screenshots -- --only chat-composer
bun run docs:screenshots -- --skip-seed --only chat-document-attachment,project-task-detail
bun run docs:screenshots -- --grep '^governance-'
bun run docs:screenshots -- --locales en,de,fr --only home-inbox
bun run docs:screenshots
```

Without `--skip-seed`, the runner checks and creates demo content before taking the selected shots.
Use `--skip-seed` only after a successful seed, when the persisted entity IDs still exist.

The runner saves reusable authentication and organization IDs in `.state/` (gitignored). Set
`TALE_SCREENSHOT_STATE_DIR` or pass `--state-dir /absolute/path` to keep a capture environment's
authentication and seeded IDs separate. The CLI path takes precedence over the environment.
The runner never deletes another state directory. These
files contain a session and are not documentation assets. Keep them local. When changing databases,
move the old `.state/` directory aside and bootstrap against the new database; never delete an
organization or database to repair a screenshot run.

If the isolated platform uses a separate configuration directory, pass that same path explicitly
with `--config-dir /absolute/path/to/platform/config`. The seeder writes the synthetic provider
definition and credential binding there through the normal scaffolder. Without this flag it uses
the existing `tests/e2e/fixtures/config` root. It deliberately does not inherit `TALE_CONFIG_DIR`,
so running the command from an unrelated deployment shell cannot select that deployment's config.

English remains the default and uses the existing `images/<section>/<shot>.webp` URLs.
`--locales en,de,fr` captures each scene in its native interface language; German and French
sources go under `images/<section>/de/` and `images/<section>/fr/`. The manifest records the locale.
Each browser context starts in the requested language and the preparation locators resolve that
catalog, so opening a task dialog or run detail does not require a locale-changing reload.
Synthetic workspace content is shared between languages; user-written task and conversation text
remains the seeded content. UI labels and locale formatting come from the real application.

To regenerate all localized marketing product screens and their responsive derivatives in order:

```bash
TALE_SCREENSHOT_STATE_DIR=/absolute/path/to/isolated-capture-state bun run web:screenshots
bun run web:screenshots -- --state-dir /absolute/path/to/isolated-capture-state --config-dir /absolute/path/to/platform/config --skip-seed
```

This command captures the homepage task detail and the seven platform screens before running the
marketing image optimizer. It uses the same fixtures, state, readiness gates, and manifest as docs.
The orchestrator derives its source list from the marketing registry and forwards capture flags
before running the optimizer. Use `--only` and `--locales` for a targeted refresh after all required
sources have been captured. `--list` only enumerates shots and does not run the optimizer.

### Record the marketing product in action

`web:animations` records eight individual native interactions using the same authentication,
organization, seed, locale helpers, shot preparation, and readiness gates as screenshots. It
reuses the docs-video CDP recorder and ffmpeg helpers; these silent takes do not invoke narration,
paid TTS, or title cards. Install ffmpeg and ffprobe on PATH, or set
`VIDEO_INGEST_FFMPEG_LOCATION` to their directory.

```bash
bun run web:animations -- --list
bun run web:animations -- --state-dir /absolute/path/to/isolated-capture-state --config-dir /absolute/path/to/platform/config
bun run web:animations -- --state-dir /absolute/path/to/isolated-capture-state --config-dir /absolute/path/to/platform/config --skip-seed --only agents,chat --locales de,fr
bun run web:animations:verify
bun run web:animations:verify -- --review-dir /absolute/path/outside/checkout/motion-review
```

The default matrix is `home`, `hub`, `agents`, `chat`, `projects`, `automations`, `knowledge`, and
`governance`, each in English, German, and French. Swiss German reuses German. Every page has a
1280 × 800 desktop take and a separate 390 × 820 native phone take; the phone view is not a crop
of the desktop. Controls use the real interface catalog. Shared synthetic workspace content
remains English, while typed comment and Inbox drafts are localized capture content.

Each route and interaction warms off camera before recording. Comment and Inbox composers must
be empty before typing; drafts are cleared without submitting. The chat scene sends a real
grounded request and removes only the new threads it registered, in a finally block. Other scenes
inspect existing tasks, agents, knowledge entries, audit events, and completed automation steps.
Keep the isolated provider's native display name suitable for the example, such as `Team model
gateway`, through its normal organization configuration. Preserve its driver, model, endpoint,
and environment-based credential binding; do not paint a different label onto captured pixels.

Raw timestamped frames and per-take evidence remain under the selected state directory's
`motion/` folder. Encoding produces eight-second, 24 fps, 192-frame VP9 WebM and H.264 MP4 clips
with no audio. Desktop files must fit 750 KiB and phone files 350 KiB. Bounded quality retries fail
at their floor. Both codecs and the native first-frame poster are staged in the take's own state
directory before publication. Posters use the existing responsive AVIF/WebP image optimizer and
its size guard.

Published clips and full provenance live under `services/web/public/marketing/product-motion/`;
responsive posters live under `services/web/public/marketing/optimized/`. Compact browser
registries derive canonical URLs and fixed native geometry. The disk-only `manifest.json` retains
source shot, route, locale, viewport, DPR, dimensions, timing, frame hashes, semantic before/after
assertions, an interaction region, and each file's bytes and SHA-256. These hashes and unused blur
previews do not enter the browser bundle.

`web:animations:verify` requires all 48 native takes and 96 encoded clips. It checks hashes,
budgets, containers, codecs, dimensions, duration, exact frame rate/count, and absence of audio,
then decodes both codecs before and after the action and checks changed pixels inside the
declared interaction region. Review actual playback in every layout as well: machine checks
cannot judge whether the action and text remain useful at normal reading width.
The optional `--review-dir` retains a decoded full-frame MP4 result PNG for each native take;
keep this visual review evidence outside the checkout.

For each changed image:

1. Open the WebP and verify that the intended controls, data, and state are visible.
2. Preview the page at normal reading width and on a narrow screen. An image that is technically
   sharp may still be unreadable inside a page.
3. Check the surrounding steps against the image. Docs pages normally use English captures with
   native captions and alt text; the prose names the actual localized UI controls.
4. Commit the shot definition, generated WebP, `images/manifest.json`, and all affected locale pages
   together.

```bash
bun run --filter @tale/docs test
bun run --filter @tale/docs dev
```

## Refresh the README gallery

The English, German, and French READMEs share six thumbnails. Each links to its full-resolution
source. After starting the platform and successfully seeding it, retake those source images:

```bash
bun run docs:screenshots -- --skip-seed --only chat-arena-split,projects-task-board,project-agents-models,automation-editor-canvas,connectors-add-credential,governance-guardrails
bun run readme:assets --gallery-only
```

`--gallery-only` rebuilds the six WebP thumbnails under `.github/assets/` without regenerating the
animated tour. The thumbnails preserve the entire frame and use a higher quality setting for
small UI text. The source images remain governed by the docs pipeline's size budget.

Inspect all six sources and thumbnails, then preview each README at a normal repository reading
width and a narrow viewport. Check the captions, image links, and [visual guide](../../../../SCREENSHOTS.md)
against the captured state. A freshly captured image can still show a loading screen or an
irrelevant state; capture success alone is not visual approval.

## What the pipeline verifies

- Preflight checks the app and gateway are reachable. A responsive app alone does not prove its
  database, object store, model, or sandbox is configured.
- Bootstrap creates the demo owner and drives the organization wizard. Seeding uses real UI flows
  for projects, tasks, files, settings, and conversations, and starts one test run of a shipped
  automation. It fills the Inbox the way an integration does: it creates an API key named
  `Helpdesk sync` and mirrors three customer conversations through the REST API. The provider and
  embedding model are configured before document uploads; failed indexing can be retried during
  seeding.
- Each capture uses a fresh browser context with light theme, the selected locale (English by default), reduced motion, and
  a default 1440 × 900 viewport at DPR 2. A shot may declare its own viewport or element crop.
- Readiness is a UI state, not an arbitrary delay. The attachment detail waits for indexing progress to
  be replaced by the file size; a screenshot must not hide a failed state.
- Each marketing scene also waits for a translated control from its own route topic, after its
  data gate. A matching HTML language alone cannot admit a temporarily English table or dialog.
- Images are encoded as WebP below the pipeline's 190 KB budget. The generated manifest records
  provenance, locale, and dimensions. The docs tests check that every published screenshot is
  registered and referenced by docs or the marketing screenshot registry.

The mock gateway supplies deterministic answers for visual examples. A successful mock conversation
proves the interaction and rendering, not a real model's answer quality or a provider's production
availability.

## Troubleshooting

| Symptom                                                                           | Check                                                                                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in succeeds but seeded content is missing                                    | Confirm port 3000 belongs to this checkout and `.state/` points to its database.                                                |
| Chat has no usable models                                                         | Check the gateway, provider credential, and `docs-demo` builtin catalog. The normal catalog needs real provider credentials.    |
| File upload fails or stays in indexing                                            | Check object storage, the knowledge database and corpus migrations, the embedding model, and backend logs.                      |
| A selected shot cannot find its project or thread                                 | Run the seed and retain the new `.state/` IDs before using `--skip-seed`.                                                       |
| A model identifier is absent from the visible option label                        | Search by the API identifier, then select the matching friendly model name.                                                     |
| `settings-sandboxes` or `sandbox-infrastructure-capacity` never reaches readiness | Supply a connected Docker spawner with matching `SANDBOX_URL` and `SANDBOX_TOKEN`. These shots require a real host observation. |

Use `E2E_BASE_URL` for another app origin and `TALE_MOCK_CONNECTORS_BASE` for another mock gateway.
Shots that print the deployment's address replace the page's own origin, so a stack on another port
still publishes the production-shaped host. The provider fixtures under
`tests/e2e/fixtures/config/{default,docs-demo}/providers/e2e-mock.yml` name the gateway at
`127.0.0.1:4141`. For another gateway port, copy `tests/e2e/fixtures/config` with `cp -RL` (its
`docs-demo` links are relative), point the copied `e2e-mock.yml` files at the port, and run the
platform and the capture on the copy (`TALE_CONFIG_DIR`, `TALE_CONFIG_BUILTIN_DIR` and
`--config-dir`). The seeder copies the demo org's provider definition from that root, so the tracked
fixtures never change.
The manifest is the complete shot inventory; a subset capture does not verify all screenshots.
