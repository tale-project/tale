# Capture documentation screenshots

The screenshot runner drives the real platform with synthetic demo content and a mock model gateway.
It produces the WebP files under `services/docs/public/images/` and their generated manifest. Add or
change a shot in [`manifest.ts`](manifest.ts); never hand-edit a screenshot to imply product behavior.

Read the [screenshot guide](../../../../.agents/skills/write-docs/SCREENSHOTS.md) for framing and
[docs contract](../../../../docs/AGENTS.md) for embedding images and translating captions.

## Prepare a local platform

Use a disposable development environment. The seeder creates an organization, documents, tasks,
credentials, and governance examples; do not point it at a customer deployment or a database whose
contents you need to preserve.

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
gateway on 4141. `TALE_E2E=1` skips the video toolchain; it does not replace the database or object
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
bun run docs:screenshots
```

Without `--skip-seed`, the runner checks and creates demo content before taking the selected shots.
Use `--skip-seed` only after a successful seed, when the persisted entity IDs still exist.

The runner saves reusable authentication and organization IDs in `.state/` (gitignored). These
files contain a session and are not documentation assets. Keep them local. When changing databases,
move the old `.state/` directory aside and bootstrap against the new database; never delete an
organization or database to repair a screenshot run.

For each changed image:

1. Open the WebP and verify that the intended controls, data, and state are visible.
2. Preview the page at normal reading width and on a narrow screen. An image that is technically
   sharp may still be unreadable inside a page.
3. Check the surrounding steps against the image. Localized pages use English captures with
   native captions and alt text; the prose names the actual localized UI controls.
4. Commit the shot definition, generated WebP, `images/manifest.json`, and all affected locale pages
   together.

```bash
bun run --filter @tale/docs test
bun run --filter @tale/docs dev
```

## What the pipeline verifies

- Preflight checks the app and gateway are reachable. A responsive app alone does not prove its
  database, object store, model, or sandbox is configured.
- Bootstrap creates the demo owner and drives the organization wizard. Seeding uses real UI flows
  for projects, tasks, files, settings, and conversations. The provider and embedding model are
  configured before document uploads; failed indexing can be retried during seeding.
- Each capture uses a fresh browser context with light theme, English locale, reduced motion, and
  a default 1440 × 900 viewport at DPR 2. A shot may declare its own viewport or element crop.
- Readiness is a UI state, not an arbitrary delay. The attachment detail waits for indexing progress to
  be replaced by the file size; a screenshot must not hide a failed state.
- Images are encoded as WebP below the pipeline's 190 KB budget. The generated manifest records
  provenance and dimensions. The docs tests check that every published screenshot is registered.

The mock gateway supplies deterministic answers for visual examples. A successful mock conversation
proves the interaction and rendering, not a real model's answer quality or a provider's production
availability.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Sign-in succeeds but seeded content is missing | Confirm port 3000 belongs to this checkout and `.state/` points to its database. |
| Chat has no usable models | Check the gateway, provider credential, and `docs-demo` builtin catalog. The normal catalog needs real provider credentials. |
| File upload fails or stays in indexing | Check object storage, the knowledge database and corpus migrations, the embedding model, and backend logs. |
| A selected shot cannot find its project or thread | Run the seed and retain the new `.state/` IDs before using `--skip-seed`. |
| A model identifier is absent from the visible option label | Search by the API identifier, then select the matching friendly model name. |
| `settings-sandboxes` never reaches readiness | Supply a connected Docker spawner with matching `SANDBOX_URL` and `SANDBOX_TOKEN`. This shot requires a real host observation. |

Use `E2E_BASE_URL` for another app origin and `TALE_MOCK_CONNECTORS_BASE` for another mock gateway.
The manifest is the complete shot inventory; a subset capture does not verify all screenshots.
