# Claude Code — Tale

**Read [`AGENTS.md`](../AGENTS.md) in full first.** It is the canonical contract for working in this
repository: how to work, the Definition of Done, the Ripple Map, the verification doctrine, the
coding standards, and the index of skills (deep guides loaded on demand). Everything below is a
Claude-Code-specific delta on top of it — not a replacement.

## Harness notes

- **Skills live in [`.claude/skills/`](skills/).** Load the relevant guide before working in
  an area (e.g. `convex`, `react`, `testing`); the index is in `AGENTS.md`. Don't reinvent what a
  skill already documents.
- **Commands:** `/qa <area>`, `/verify`, `/ship`, `/release [version]`. **MCP servers:** Playwright (frontend
  verification), Convex (backend verification), Pencil (design). See [`.mcp.json`](../.mcp.json).
- A PostToolUse hook formats every file you edit; don't hand-format or re-run a formatter.

## Git

- **Never** add `Co-Authored-By` to commit messages.
- **Never** add "Generated with Claude Code" or any similar attribution to commits or PR
  descriptions.

## Other deltas

- **Never** use an empty catch block — log (`console.warn`/`console.error`) or re-throw.
- `design/comments.md` is strictly designer↔developer UI communication. Put code-level bug analysis
  in a GitHub issue, never there.
