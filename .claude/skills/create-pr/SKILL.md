---
name: create-pr
icon: lucide:git-pull-request-arrow
labels: ['GitHub']
description: 'Use this skill whenever you take a finished change to a pull request — it is the required pre-merge routine: walk the definition of done and the ripple map, run the full gate, verify the behaviour, review the diff, then open one focused PR with atomic conventional commits. Load it the moment a task says "open a PR", "ship it", "commit", "raise a pull request", or whenever a change is done in your head but not yet landed. Never open a PR or commit without it — the cross-cutting work (migration, translations, docs, tests) is what gets forgotten.'
---

# create-pr

The last mile: turn a finished change into a mergeable PR **without leaving cross-cutting work
undone**. It composes the other skills — run them, don't restate them — and it owns the shared
**definition of done**: every work skill's Gate B points here. The failure it exists to catch is the
most common one: doing the code and forgetting the rest — the translation, the doc, the migration,
the test. To review the diff first use `review-code`; for a colleague's PR, `review-pr`.

## When this applies

Before you open any PR, and when a change is "done" in your head but not yet landed. By here the code
is written; this is the routine that proves it's actually finished.

## Write a note first

**Invoke `write-notes`** and answer this form — it seeds the PR description:

- **Summary:** Describe what changed and why, in a few sentences (the seed for the PR description).
- **Ripple:** Walk through each cross-cutting area (migration, i18n, docs, tests, a11y) — for each, describe what this change required there and what you did about it.
- **Verification:** Describe what you observed to prove it works — the evidence, not "it should work".
- **Risks & unknowns:** Describe the riskiest part for a reviewer to look at first, and anything you couldn't fully verify or are unsure about.

## Run the routine in order — each step gates the next

1. **Walk the sweep and the definition of done.** A change is rarely one file: re-run the Gate A
   sweep (`search-codebase`) so every enumerated site is changed or explicitly ruled out, then walk
   the checklist below — a user-visible string → every locale; a data-model change → its migration;
   a new interactive element → label + accessibility + docs + tests. Confirm each is done or
   **explicitly N/A** (and say so in the commit body).
2. **Review the diff** (`review-code`) — your own skeptical read first, then the project's automated
   reviewers. Address the findings.
3. **Run the gate** — green is necessary, never sufficient: the project's format/lint/typecheck/test
   command; its security / SAST gate; its migration check if a data model changed; its end-to-end
   suite for any touched frontend. Read the project's contributor docs for the exact commands.
4. **Verify the behaviour** (`test-code`) — for anything a user can see or call, observe the real
   outcome (run it, drive the UI, exercise the backend), not just a green test. An honest "couldn't
   verify X because Y" beats a false "done".
5. **Commit and open the PR:**
   - **Atomic commits** — one logical change each; if the message needs "and", it's two commits.
   - **Conventional, imperative, lowercase header** within the project's length limit and allowed
     scopes — _read the project's commit config_, don't assume.
   - **Branch off the main branch; never push straight to it.**
   - **Follow the project's PR/attribution rules** — read them; some repos ban certain trailers or
     require a template. Capture anything non-obvious you learned in the PR description (or the
     project's memory), never in a throwaway code comment.
   - Paste the done checklist into the PR body, **every box ticked or marked N/A**.

## The definition of done — the shared Gate B

Every work skill's Gate B points here. **Every applicable box is ticked, or N/A with a reason**,
before you open the PR — an empty box or an unverified claim means it is not ready:

- [ ] **Green gate** — the project's format / lint / typecheck / test command passes locally.
- [ ] **Security gate** — the project's security / SAST check is clean for any boundary touched.
- [ ] **Tests** — the change carries tests: happy path + one edge + one error (`test-code`).
- [ ] **Migration** — a data-model or config-schema change ships its reversible, tested migration.
- [ ] **Locales** — every user-visible string is localized in all the project's locales.
- [ ] **Docs** — updated for anything a user can see, configure, or call — including any instruction
      file that documents a changed path, command, or pattern.
- [ ] **Accessibility** — AA holds for any UI: real elements, keyboard reachable, labels, contrast.
- [ ] **Sweep** — every site enumerated at Gate A is changed or explicitly ruled out
      (`search-codebase`).
- [ ] **Observed** — behaviour verified by observing the real outcome (`test-code`), not just a
      green test.
- [ ] **Commits** — atomic, conventional, branched off the main branch, the project's attribution
      rules followed.

## Patterns

Don't:

- **Open the PR "to see if CI passes"** instead of running the gate locally — it wastes CI and reviewer time.
- **Bundle unrelated changes** into one PR — one logical change, one PR.
- **Mark a box done you didn't do** — the checklist is a promise, not decoration.
