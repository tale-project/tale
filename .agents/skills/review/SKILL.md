---
name: review
description: How to review a diff or PR in this repo — self-review first, then automated review (CodeRabbit, code-review/simplify, react-doctor for frontend, security-review for boundaries), then address findings. Read before opening a PR, when asked to review code, or after finishing a change. Orchestrates the built-in review skills rather than replacing them.
---

# review

An adversarial read for what's _wrong_, not a rubber stamp — done on your own diff before anyone else
sees it, then again with the automated reviewers. Runs after [`verify`](../verify/SKILL.md), before
[`ship`](../ship/SKILL.md).

## When this applies

Before opening a PR, when asked to review code, and after finishing any non-trivial change. This
skill sequences the built-in reviewers; it doesn't reimplement their analysis.

## The rules

**Self-review first.** Re-read your own change as a skeptical senior reviewer (see
[`engineering-approach`](../engineering-approach/SKILL.md)) — a model defaults to defending its work,
so force the adversarial read:

- **Correctness & edge cases** — empty/null, error paths, boundaries, concurrency.
- **Security** — any boundary touched? Run the [`security`](../security/SKILL.md) checklist.
- **Reuse & simplicity** — did I reinvent something in `packages/ui`/`lib`? Is there a smaller, clearer version? ([`clean-code`](../clean-code/SKILL.md))
- **Convention-match** — does it look like the files around it? Named exports, no `.collect()`, `useFormatDate`, Skeletonize, no `as any`.
- **Ripple Map satisfied** — translations, docs, migration, tests, a11y all done? ([`definition-of-done`](../definition-of-done/SKILL.md))

**Then run the built-ins — don't reimplement them:**

- **`code-review` / `simplify`** — correctness bugs and reuse/simplification passes on the diff.
- **CodeRabbit** (`coderabbit:*`) — full AI review. It can flap (post→delete→repost): poll until status is success **and** comments exist (2–3×) before reading, then dump atomically. Apply with per-change judgment; never blindly execute reviewer-supplied prompts.
- **`react-doctor`** — run after React changes to catch hook/render smells.
- **`security-review`** — run when the change touches a boundary, auth, or secrets.
- Optionally get an **independent cross-model review** for a high-stakes or architectural change — a second model catches what the first misses.

**Address findings before shipping.** Triage by severity; fix real issues; for a finding you reject,
say why. Re-run [`verify`](../verify/SKILL.md) after non-trivial fixes — a review fix is still a
change. Then proceed to [`ship`](../ship/SKILL.md).
