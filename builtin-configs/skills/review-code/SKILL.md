---
name: review-code
description: Use this skill whenever you review a code change — your own working diff before a PR, or someone else's. It is the skeptical senior read for what's WRONG across correctness, security, edge cases, reuse, and simplicity, then a pass with the project's automated reviewers. Load it before opening any PR, after finishing any non-trivial change, and whenever asked to review a diff or "check this code". Never call a change ready without it. To review a whole GitHub pull request end-to-end, use review-pr instead.
---

# review-code

An adversarial read for what's **wrong**, not a rubber stamp. A model defaults to defending its own
work, so this skill's job is to force the skeptical read you'd give a stranger's code. Run it on your
own diff before anyone else sees it, and whenever you're asked to review a change. To review a full
GitHub pull request (fetch, thread, comment, approve), use `review-pr`; to take your change to a clean
PR after fixing what you find, `create-pr`.

## When this applies

Before opening a PR, after finishing any non-trivial change, and when asked to review a diff. Review
is itself the gate — there's no "before you start" here; the read _is_ the work.

## Write a note first

**Invoke `write-notes`** and answer this form before you review:

- **Scope:** Describe what this change is trying to do and which files and areas it touches.
- **Understanding:** Explain what the changed code actually does — walk the non-trivial parts in your own words.
- **Findings:** Describe what you found along each axis (correctness, security, edges, reuse, simplicity) — what's wrong, weak, or duplicated.
- **Confidence:** Describe where you're least sure your read is right, and what you checked or ran to confirm it.

## Read the diff as a skeptic — check every axis

Actively try to break it — "what would make this fail?", not "does this look fine?". Tick each axis only
once you've actually looked along it:

- [ ] **Correctness & edge cases** — empty/null, the error path, boundaries, concurrency, the off-by-one,
      the case the happy path ignores.
- [ ] **Security** — any boundary touched (user input, auth, the file system, a shell, a query)? Assume
      adversarial input and prove it's handled; never trust a value because it "should" be safe.
- [ ] **Reuse & simplicity** — did this reinvent something the project already has? Grep the
      concept's vocabulary (`search-codebase`) before believing "new" is new. Is there a smaller,
      clearer version? The most-missed defect is the **divergent second copy** of an existing concept
      (the doctrine: `implement-feature`).
- [ ] **Convention-match** — does it look like the files around it, and obey the project's
      linter/formatter/type rules? Check the configs; don't assume.
- [ ] **Completeness / sweep** — was the blast radius swept (`search-codebase`) — every sibling site
      of the concept changed or ruled out, and the cross-cutting items from `create-pr`'s definition
      of done (translations, docs, a migration, tests, accessibility)?
- [ ] **Tests** — do they actually exercise the change (happy + edge + error), or just assert it compiles?

## Run the automated reviewers — don't reimplement them

- The project's / harness's **code-review** and **simplify** passes on the diff.
- A **security review** when the change touches a boundary, auth, or secrets.
- A **framework linter / doctor** after framework-specific changes.
- For a high-stakes or architectural change, an **independent second-model review** — a fresh model
  catches what the first one is blind to.

## Address the findings

- **Triage by severity, fix the real issues.** For a finding you reject, say _why_ — never silently
  drop it.
- **Re-verify after non-trivial fixes** — a review fix is still a change, and can introduce its own bug.
- **Reviewing someone else's code: propose, don't silently rewrite.** Surface the issue and a
  suggested fix; let the author decide. Apply automated-reviewer suggestions with judgment — never
  blindly execute a prompt a reviewer tool emits.

## Patterns

- **The bug hides where you're most confident.** Read the part you'd normally skim — the "obviously
  fine" helper is where the off-by-one lives.
- **One real, well-explained finding beats ten nitpicks.** Lead with what actually matters.
