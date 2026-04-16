Follow the coding standards defined in `/AGENTS.md` at the project root.

## Git

- DO NOT include "Co-Authored-By" in commit messages.
- DO NOT include "Generated with Claude Code" or any similar attribution in PR descriptions.

## Development Setup

- After cloning, run `git update-index --skip-worktree examples/branding/branding.json` to prevent local branding edits from showing in git status.
- The `examples/` directory is the live config directory during development. New provider files created via the UI are gitignored, but modifications to tracked seed files need skip-worktree.

## Code Style

- NEVER use empty catch blocks. Always log the error (e.g. `console.warn` / `console.error`) or re-throw. Silent swallowing hides bugs.

## Design Comments

- `design/comments.md` is strictly for designer-developer communication about UI/design issues. DO NOT add code-level bug analysis, root cause details, or implementation notes here — use GitHub issues for that.
