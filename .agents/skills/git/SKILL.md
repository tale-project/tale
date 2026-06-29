---
name: git
description: The git workflow for the Tale monorepo — conventional commits and the allowed scopes, the repo-specific ban on Claude attribution (no `Co-Authored-By`, no "Generated with Claude Code") in commits and PRs, branching off main, stash vs worktree, rebasing/syncing, force-pushing safely, and recovering lost work. Read before committing, branching, choosing stash vs worktree, rebasing, force-pushing, or recovering lost work.
---

# git

Day-to-day git in this repo: small atomic conventional commits on a feature branch off `main`, kept
linear by rebasing, recovered with `reflog` — never a destructive reset. Commit and branch _naming_
are hook-enforced; the rest is discipline. Shipping a PR (the gh/CI dance) lives in
[`ship`](../ship/SKILL.md); reading a diff for correctness lives in [`review`](../review/SKILL.md).

## When this applies

Any time you create a commit, start a branch, switch context mid-WIP, sync your branch with `main`,
push over rewritten history, or think you've lost work. Picking between `git stash` and
`git worktree add`? This is the guide.

## The rules

- **Never attribute a commit to Claude.** No `Co-Authored-By`, no "Generated with Claude Code", no
  similar trailer — in commits _or_ PR descriptions. This contradicts the common git default, so it's
  easy to slip; it's a hard repo rule ([`.claude/CLAUDE.md`](../../../.claude/CLAUDE.md)). Reviewer-caught.
- **Conventional commits, enforced.** `type(scope): subject` — e.g. `fix(platform): gate query on
auth`. The `commit-msg` husky hook runs `commitlint` ([`.commitlintrc.json`](../../../.commitlintrc.json),
  `@commitlint/config-conventional`) and **rejects** a bad header. Subject: ≤72 chars, lowercase,
  imperative ("add", not "added"/"adds"), no trailing period.
- **Allowed scopes** — the only ones commitlint accepts: `cli`, `controller`, `convex`, `crawler`,
  `db`, `deps`, `design`, `docs`, `platform`, `plop`, `pii`, `proxy`, `rag`, `sandbox`, `storybook`,
  `ui`, `web`, `workflow`. Anything else (e.g. `frontend`) is rejected.
- **Atomic commits — one logical change each.** If the subject needs an "and", it's two commits; split
  with staged hunks. The body explains _why_; the diff already shows _what_.
- **Branch off `main`; never commit to `main` directly.** Create a feature branch first; branch names
  mirror commit types (`feat/…`, `fix/…`, `chore/…`).
- **Don't fight the hooks.** [`pre-commit`](../../../.husky/pre-commit) runs `oxfmt` (formats +
  re-stages — never hand-format) then a fast staged-only OpenGREP SAST scan that blocks on a real
  finding. Fix the finding; don't `--no-verify` past it. SAST itself is [`security`](../security/SKILL.md).
- **Force-push only with `--force-with-lease`, never plain `--force`.** The lease aborts if someone
  else pushed, so you can't silently clobber a teammate's (or a parallel agent's) commits.
- **Never destroy uncommitted work without permission.** `git reset --hard`, `git checkout -- .`, and
  `git clean -fd` are irreversible for untracked/unstaged changes. Stop and confirm what would be lost
  first — non-negotiable.

## Stash vs worktree

- **Stash** — a quick switch on the **same** branch: pull, apply a hotfix, resume. `git stash` / do
  the thing / `git stash pop`. Cheap, single tree.
- **Worktree** — when you need **two branches checked out at once**: review a PR while keeping WIP
  uncommitted, or run parallel agents. Each worktree has its own checkout and its own
  `node_modules`/build state, so they don't thrash one shared tree.

```bash
git worktree add ../tale-<branch> <branch>   # second checkout, isolated
git worktree remove ../tale-<branch>         # clean up when done
```

## Rebase & sync

Keep history linear — rebase on `main`, don't merge it in.

```bash
git fetch origin && git rebase origin/main
git push --force-with-lease                  # after a rebase, never plain --force
```

Stacked work whose base got **squash-merged** can't just rebase: the old base commits no longer exist
on `main`, so a plain rebase replays them as conflicts. Move only your commits onto the new tip:

```bash
git rebase --onto origin/main <old-base> <your-branch>
```

## Recovering lost work

Before any destructive command, check what you'd lose (`git status`, `git diff`). If history _is_
already lost — a bad reset, a dropped stash, an over-eager rebase — recover from `git reflog`: it
logs every HEAD move, including ones no branch points at anymore.

```bash
git reflog                       # find the sha from before the mistake
git reset --hard <sha>           # ONLY after confirming the sha (this itself discards current state)
git stash list                   # a "lost" stash is often just unpopped
```

## Patterns

```text
✅ fix(convex): gate cold-load query on isAuthenticated
✅ feat(ui): add language switcher to the command palette
❌ Fixed bug and updated tests.   # not conventional, not atomic, past tense, trailing period
❌ feat(frontend): …              # "frontend" isn't an allowed scope → commitlint rejects
```
