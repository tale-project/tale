@../AGENTS.md

## Notes

- Respect hooks that change formatting; don't hand-format or re-run a formatter.

## Git

- **Never** add `Co-Authored-By` to commit messages.
- **Never** add "Generated with Claude Code" or any similar attribution to commits or PR
  descriptions.

## Pencil

- `design/docs/comments.md` is strictly designer↔developer UI communication. Put code-level bug analysis in a GitHub issue, never there.

## Other

- **Never** use an empty catch block — log (`console.warn`/`console.error`) or re-throw.
