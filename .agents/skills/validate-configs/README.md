# validate-configs

Validating Tale's file-based org config — the builtin-configs catalog, the e2e fixture trees, the
config-domain registry and its Zod schemas, and the CI gates that guard them.

A plain (docs-only) skill — its guidance lives entirely in [`SKILL.md`](SKILL.md);
there is no bundled code. See `AGENTS.md` (the skills section) for how this skill's
home ships and where to register it (a repo-dev guide also needs `bun run skills:sync`).
