# Platform development and build scripts

Use the workspace commands from the repository root. Scripts in this directory
share the platform’s dependencies and configuration; it is not a separate
workspace.

## Start and diagnose local development

```bash
bun run dev
bun run setup:check
```

The root development command coordinates backing services, the Node backend and
the Vite frontend. For an already prepared stack, use
`bun run --filter @tale/platform dev:fast`; skipping Docker does not provide a
database or object store. Follow the [platform setup guide](../README.md) first.

| Responsibility | Files |
| --- | --- |
| Development orchestration and process I/O | `dev.ts`, `dev-engine.ts` |
| Backend health and restart decisions | `backend-supervisor.ts` |
| Startup gates and timeouts | `dev-gates.ts` |
| Log presentation and local modes | `dev-output.ts`, `dev-modes.ts` |
| Local development credentials | `dev-secrets.ts` |
| Machine prerequisites and remediation | `setup-check.ts` |

## Regenerate a contract or build artifact

```bash
bun run --filter @tale/platform generate:openapi
bun run --filter @tale/platform configs:validate
bun run --filter @tale/platform build
```

`generate-openapi.ts` writes the public REST schema from `openapi/spec.ts`.
Review the generated document and contract fingerprint with the source change;
do not edit generated API output directly. `validate-builtin-configs.ts` checks
the shipped configuration catalog against the shared schemas. The platform build
also runs this validation and renders its boot shell through
`prerender-boot-shell.tsx`.

`cls-harness.ts` supports layout-shift investigations. Screenshot and video
production have their own runbooks under `tests/`; they are not part of ordinary
application startup. When changing a script’s flags or outputs, update its tests
and the README or skill that tells contributors to call it.
