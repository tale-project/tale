# Contributing to Tale

Thanks for helping build Tale. This page is the short, authoritative entry
point; it links to the deeper guides rather than duplicating them.

## Get running (from a fresh clone)

Prerequisites: **Bun ≥ 1.3**, **Python 3.12**, and **uv** on your `PATH`
([why and how](../docs/en/develop/contributor-setup.md#prerequisites)).

```bash
bun install            # wire up every workspace
bun run setup:check    # validate Bun, Python, uv, ports, the Convex CLI
bun run dev            # boot Convex + Vite (wait for the READY banner)
```

You do **not** need Docker for source development; `bun run dev` runs Convex
directly. The `web` and `docs` sites need neither Docker nor Convex — run just
one with `bun run --filter @tale/web dev` (or `@tale/docs`). The full guide,
including port conflicts, hybrid Convex mode, and the Python services, is
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

## Reporting bugs & ideas

Use the [issue templates](ISSUE_TEMPLATE) (bug, feature, improvement, docs). For
questions, open a [Discussion](https://github.com/tale-project/tale/discussions).
For a vulnerability, **do not** open a public issue — use GitHub's private
reporting (the repository's **Security** tab → **Report a vulnerability**).

Please keep interactions respectful and constructive.
