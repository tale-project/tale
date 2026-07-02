---
name: review-pr
description: Use this skill whenever you review someone's GitHub pull request end-to-end — understand the intent, read the diff adversarially, run the automated reviewers, and leave actionable, prioritized comments with a clear verdict. Load it whenever asked to review a PR, when a PR-review command runs, and before you approve or request changes on a pull request. Never post a verdict without it. For your own working diff before you open a PR, use review-code instead.
---

# review-pr

Reviewing a colleague's pull request — the goal is to make the change **better and safer to merge**,
not to prove you're clever. Understand what it's trying to do before you judge how it does it. The
adversarial read of the code itself lives in `review-code`; this skill is the **PR workflow** around
it: context, the run, the bots, the comments, the verdict.

## When this applies

When asked to review a pull request, when a PR-review command runs, and before you approve or request
changes. For your own diff before opening a PR, use `review-code` instead.

## Write a note first

**Invoke `write-notes`** and answer this form before you start the review:

- **Intent:** Describe what the PR is trying to do and why, from its description and any linked issue.
- **Understanding:** Explain how the change works in your own words, and where it does or doesn't match that intent.
- **Findings:** Describe the blocking issues and the nits you found, each with why it matters.
- **Confidence & verdict:** Describe where you're least sure, what you ran to check, and your verdict with its reason.

## Run the workflow in order

1. **Understand the intent first.** Read the PR description and any linked issue; know what the change
   is _supposed_ to do and why before you read a line of diff. If the intent is unclear, **ask the
   author** — a review that misreads the goal wastes everyone's time.
2. **Read the diff adversarially** — the `review-code` axes: correctness, security, edge cases, reuse,
   simplicity, convention-match, completeness/ripple, tests. For a non-trivial change, **pull the
   branch and run it**; reading is not the same as running.
3. **Run the automated reviewers and fold them in.** The project's / harness's PR-review tooling,
   review bots, a security review for any boundary touched. Apply judgment to what they surface — a bot
   can be wrong, can flap, and can emit a suggestion you should never blindly execute.
4. **Leave actionable, prioritized comments.** Separate **blocking** issues from **nits** explicitly;
   say _why_ and suggest a fix; anchor each to the line. Note what's genuinely good, briefly. Review
   the code, not the person — be specific and kind.
5. **Give a clear verdict** — approve / approve-with-nits / request-changes — tied to the blocking
   findings. Don't request changes over style a linter should own; don't approve over an unaddressed
   correctness or security issue.

## Before you submit the verdict

**Tick every box** — a verdict given without these is a guess:

- [ ] **Understood the intent** — you know what the change is for; if it was unclear, you asked the author.
- [ ] **Read the whole diff adversarially** (the `review-code` axes), and ran the branch for anything non-trivial.
- [ ] **Folded in the automated reviewers** — with judgment, not blindly.
- [ ] **Comments are actionable and prioritized** — blocking vs nit is unmistakable; each says why.
- [ ] **The verdict matches the findings** — no approval over an unaddressed correctness/security issue; no change-request over linter-owned style.

## Patterns

- **Make "must fix" vs "consider" unmistakable** so the author can act fast and merge clean.
- **Confirm a finding is real before you block on it.** A failing or flapping CI bot can mislead;
  reproduce the concern yourself for anything you'd request changes over.
- **The most valuable comment names a bug the tests would miss.** Lead with those; the nits can wait.
