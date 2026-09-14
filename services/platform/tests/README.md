# Platform tests

Choose the layer that proves your change. Run workspace scripts from the repository root with
`bun run --filter @tale/platform <script>`; root-level Docker scripts run from the repository root.

| Layer | What it proves | Entry point |
| --- | --- | --- |
| Server and library tests | Domain rules, request handling, parsing, and deterministic effects | `bun run --filter @tale/platform test` |
| React interaction tests | Component behavior, validation, and accessibility semantics | `bun run --filter @tale/platform test:ui` |
| Browser component tests | Behavior that depends on the browser engine | `bun run --filter @tale/platform test:browser` |
| Backend integration | Real Postgres, migrations, transactions, auth, and API effects | `bun run --filter @tale/platform backend:integration` |
| Full application | Browser journeys against a running platform | [E2E README](e2e/README.md) |
| Manual review | Layout, focus, live interactions, and exploratory behavior | [Manual test guide](manual/readme.md) |
| Documentation images | Repeatable captures of real UI with demo data | [Screenshot runbook](docs-screenshots/README.md) |

The [backend README](../backend/README.md) explains integration prerequisites. Use a dedicated test
database and configuration directory. A separate Git checkout alone does not isolate Postgres,
object storage, or other backing services.

## Container tests

The Bun scripts under [`integration/`](integration/) build or inspect images and exercise container
contracts. They require Docker and the dependencies described in each script's header.

| Root command | Script |
| --- | --- |
| `bun run docker:test` | `integration/container-smoke-test.ts` |
| `bun run docker:test:image` | `integration/container-image-test.ts` |
| `bun run docker:test:web` | `integration/container-web-test.ts` |
| `bun run docker:test:docs` | `integration/container-docs-test.ts` |
| `bun run docker:test:sandbox-runtime` | `integration/container-sandbox-runtime-test.ts` |
| `bun run docker:test:vulnerability` | `integration/container-vulnerability-scan.ts` |
| `bun run docker:e2e` | `integration/master-e2e-test.ts` |

Read the selected script before using flags such as `SKIP_BUILD` or `KEEP_RUNNING`; availability and
cleanup behavior belong to that script. Keep traces and local session evidence outside the clone.
Published manual-round records follow the [round journal](manual/runs/readme.md).
