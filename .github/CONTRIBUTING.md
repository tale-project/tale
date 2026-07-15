# Contributing to Tale

Thanks for helping build Tale. This page is the short, authoritative entry
point; it links to the deeper guides rather than duplicating them.

## Get running (from a fresh clone)

Prerequisites: **Bun ≥ 1.3**
([why and how](../docs/en/develop/contributor-setup.md#prerequisites)). Python 3.12 and
uv are only needed for the full gate — `bun run check` / `bun run verify` shell out to
`uvx ruff` and run the Python test suites — and for the bundled Python skills.

```bash
bun install            # wire up every workspace
bun run setup:check    # validate Bun, free ports, the Convex CLI
bun run dev            # boot Convex + Vite (wait for the READY banner)
```

You do **not** need Docker for source development; `bun run dev` runs Convex
directly. The `web` and `docs` sites need neither Docker nor Convex — run just
one with `bun run --filter @tale/web dev` (or `@tale/docs`). The full guide,
including port conflicts and hybrid Convex mode, is
[Contributor setup](../docs/en/develop/contributor-setup.md).

## Before you open a PR

One gate decides merge: **`bun run check`** (format, lint, typecheck, and the
full TypeScript + Python test suites). Green is the signal; red blocks.

```bash
bun run verify         # one shot: format + lint + typecheck + tests + UI + knip + SAST
bun run test:e2e       # Playwright (only if you touched a frontend service)
```

`verify` mirrors the blocking CI checks; run `bun run check` alone for the
faster format/lint/typecheck/test subset while iterating.

- **Docs & translations ship with the code.** Anything a user can see,
  configure, or call needs its docs updated in all three base locales
  (`docs/en`, `docs/de`, `docs/fr`) in the same PR. The PR template has the
  decision tree.
- **Conventional commits.** `bun run commit` walks you through a valid message;
  CI lints it.
- The complete engineering contract — code style, security rules, TypeScript and
  React conventions, the full pre-PR checklist — is in
  [`AGENTS.md`](../AGENTS.md). Read it once.

## Known issues

- **xlsx security vulnerability**: the project uses xlsx@0.18.5, which has known
  vulnerabilities (Prototype Pollution and ReDoS). It is the latest released version —
  no fix exists yet. The package parses Excel files in the documents feature.
- **ENVIRONMENT_FALLBACK warning**: the platform build may print an
  `ENVIRONMENT_FALLBACK` error. It is a Convex-specific warning and does not prevent
  successful builds.
- **GitHub Code Quality is disabled**: the `github-code-quality` default setup was
  turned off (Settings → Security → Code quality, or
  `PATCH /repos/.../code-quality/setup` with `state: not-configured`). It reported
  persistent false positives on this repo (e.g. Convex `"use node"` as an unknown
  directive). Keep it off; lint and SAST stay with oxlint and Opengrep
  (`bun run check` / `bun run lint:sast`).

## Reporting bugs & ideas

Use the [issue templates](ISSUE_TEMPLATE) (bug, feature, improvement, docs). For
questions, open a [Discussion](https://github.com/tale-project/tale/discussions).
For a vulnerability, **do not** open a public issue — use GitHub's private
reporting (the repository's **Security** tab → **Report a vulnerability**).

Please keep interactions respectful and constructive.
