# Tale — connector & container tests

Bun/TypeScript suites that build, validate, and smoke-test the Docker images and
the running stack. They live inside `@tale/platform` (no separate workspace) and
run with `bun` — no build step, no extra install; they use only Bun and `node:*`
built-ins.

> Automated suites live in [`connector/`](connector/); manual / AI-directed
> exploratory test playbooks live in [`manual/`](manual/) (run by a human or an
> AI agent against a running instance, not in CI).

## Suites

All suite scripts live under [`connector/`](connector/). The `docker:test*` and
`docker:e2e` convenience scripts are exposed at the **repo root** — run
`bun run docker:test`, `bun run docker:test:web`, etc. from anywhere in the repo.
CI invokes the suite files directly (`bun services/platform/tests/integration/<name>.ts`).

| Script                                        | What it does                                                                         | Run                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `connector/container-smoke-test.ts`           | Builds all images, brings the full stack up, waits for health, probes HTTP + sandbox | `bun run docker:test`                 |
| `connector/container-image-test.ts`           | Image-only checks: OCI labels, non-root, no baked secrets, HEALTHCHECK, size budgets | `bun run docker:test:image`           |
| `connector/container-web-test.ts`             | Builds + smoke-tests the marketing site (`services/web`)                             | `bun run docker:test:web`             |
| `connector/container-docs-test.ts`            | Builds + smoke-tests the docs site (`services/docs`)                                 | `bun run docker:test:docs`            |
| `connector/container-sandbox-runtime-test.ts` | Sandbox-runtime image conformance (one-shot + agent-session roles, playwright MCP)   | `bun run docker:test:sandbox-runtime` |
| `connector/container-vulnerability-scan.ts`   | Trivy vulnerability scan per image (advisory by default)                             | `bun run docker:test:vulnerability`   |
| `connector/master-e2e-test.ts`                | Runs the platform Vitest server + UI suites                                          | `bun run docker:e2e`                  |

All suites accept the same env knobs the old shell scripts did
(`SMOKE_TEST_TIMEOUT`, `SKIP_BUILD`, `KEEP_RUNNING`, `VULNERABILITY_*`, …) — see
each file's header comment.

## Layout

- `connector/` — the Bun/TypeScript suites above.
- `connector/lib/` — shared helpers: `exec.ts` (typed `Bun.spawn` wrappers),
  `docker.ts` (compose + `docker inspect` probes), `log.ts` (colors, headers,
  the pass/fail/warn results box).
- `connector/static-site-test.ts` — shared body for the web/docs suites.
- `connector/fixtures/` — config fixtures mounted into the test stack (see `compose.test.yml`).
- `manual/` — AI-directed manual testing guides.
