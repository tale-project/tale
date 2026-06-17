---
name: skill-name
description: One sentence on what this skill is, then the triggers. Start with the capability ("How to … / The contract for …"), then "Read before …" and a list of concrete situations and phrasings that should load it. The agent decides relevance from this line alone, so pack it with real triggers (file paths, verbs, symptoms) — not adjectives.
---

# skill-name

<!--
This is the authoring standard for every skill under .claude/skills/. Copy it, fill it in, delete
these comments. The goal is progressive disclosure: a short, high-signal SKILL.md that an agent can
read in seconds, with depth pushed into companion files it loads only when it needs them.
-->

One or two sentences: what this skill covers, where it applies in the repo, and where the boundary
is (what a _sibling_ skill covers instead, linked). Lead with the rule, not the preamble.

## When this applies

The concrete situations that should pull this skill in — mirror the `description` triggers. Name
real paths and file globs (e.g. "editing `services/platform/convex/**`"). If a sibling skill is the
better fit for an adjacent case, say so and link it.

## The rules

The non-negotiables first, stated once, each with its _why_ in the same breath. Prefer a short rule

- a one-line rationale over a paragraph. Where a rule is enforced by a test/lint, name the guard so
  the reader trusts it (`enforced by …`). Where it isn't, say "reviewer-caught".

## Patterns (show, don't tell)

Concrete before/after or do/don't, grounded in real files (`path:line` when useful). One good
example beats three sentences of prose. Keep snippets minimal — the smallest code that makes the
point.

## Companion files (optional)

Long reference — playbooks, catalogues, per-locale doctrine, worked examples — lives in sibling
`.md` files in this directory, linked here with a one-line "read when". Keep `SKILL.md` itself
scannable.

---

## Authoring rules for skills (delete in real skills; this section is the meta-standard)

- **Frontmatter:** `name` (must equal the directory name, dash-case) and a trigger-rich
  `description`. These two lines are all the agent sees when deciding to load the skill — the
  `description` must contain the words someone would use when they need it.
- **Progressive disclosure:** `SKILL.md` ≤ ~150 lines. Push depth into companion `.md` files; link
  them with a reason to open them. Don't inline a 400-line reference.
- **One concern per skill.** If it needs "and" in the name, it's probably two skills. Fold tiny
  adjacent topics into a section rather than spawning a near-empty skill.
- **Cite real paths, verified.** Every file path and command must exist on the current branch —
  grep/run before writing it. Stale references (the failure that triggered this rewrite) are worse
  than no reference.
- **Link siblings,** don't duplicate them. Point to the guide that owns a topic.
- **Register it.** Adding a skill means adding its row to the skill index in `/AGENTS.md`; removing a
  skill means removing that row. The index is the map every agent reads — it must stay true.
- **Don't duplicate the ecosystem.** If a built-in/harness skill already does the job (e.g.
  `react-doctor`, `claude-api`), reference it instead of reimplementing; a custom skill should add
  Tale-specific value (real paths, repo conventions, orchestration).
