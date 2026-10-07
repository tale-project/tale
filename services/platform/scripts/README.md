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
| Sandbox runtime image and external toolchains steps | `dev-sandbox-runtime.ts`, `dev-toolchains.ts` |
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
also runs this validation, pins the service worker's precache manifest
(`check-sw-manifest.ts`), refuses a cold load that preloads the editor stack,
KaTeX, the flow canvas, a library only some pages use or a German, French or
Swiss topic file, and prints the gzip weight of the preloaded JavaScript
(`check-entry-budget.ts`), and renders its boot shell through
`prerender-boot-shell.tsx`.

## Keep the message catalogs split by topic

The catalogs live one file per topic and locale, `messages/<locale>/<topic>.yml`,
a topic being one top-level namespace (`en/chat.yml` holds `chat.*`). Every
locale has the same topic files, `de-CH` only the ones it overrides; a new
top-level namespace is a new file in each locale. The i18n parity tests enforce
both.

```bash
cd services/platform
bun scripts/messages-topics.ts resolve
```

A branch written against the former single-file catalogs (`messages/<locale>.yml`)
stops on the deleted file when it is rebased onto main or merges main. At that
stop, `messages-topics.ts resolve` three-way merges the branch's catalog edits
into the topic files and leaves conflict markers (and a failing exit) where main
changed the same lines; then `git add messages` and continue the rebase, or
commit the merge. A rebase stops again on each later commit that edits a
catalog. `messages-topics.ts split` turns single-file catalogs into this layout
and writes nothing unless every topic file parses back to its subtree.

`cls-harness.ts` supports layout-shift investigations. Screenshot and video
production have their own runbooks under `tests/`; they are not part of ordinary
application startup. When changing a script’s flags or outputs, update its tests
and the README or skill that tells contributors to call it.
