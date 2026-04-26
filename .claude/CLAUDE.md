Follow the coding standards defined in `/AGENTS.md` at the project root. The pre-PR checklist there is mandatory — do not open a PR without ticking every box (or marking N/A) and running `bun run check`.

## Git

- DO NOT include "Co-Authored-By" in commit messages.
- DO NOT include "Generated with Claude Code" or any similar attribution in PR descriptions.

## Code Style

- NEVER use empty catch blocks. Always log the error (e.g. `console.warn` / `console.error`) or re-throw. Silent swallowing hides bugs.

## Design Comments

- `design/comments.md` is strictly for designer-developer communication about UI/design issues. DO NOT add code-level bug analysis, root cause details, or implementation notes here — use GitHub issues for that.
