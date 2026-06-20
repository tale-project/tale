---
name: skill-name
description: Open with the capability ("How to … / The contract for …"), then "Read before …" and the concrete triggers that should load this skill — real file paths, verbs, and symptoms, one per branch, not adjectives. The agent decides relevance from this line alone, and the generated Cursor/Copilot adapters surface only its first sentence — so make that sentence stand alone, and say nothing the body repeats.
---

# skill-name

<!--
The authoring standard for every skill under .claude/skills/. Copy this file, fill it in, delete the
comments. A skill exists to make the agent run the SAME PROCESS every time — predictability is the
point. Keep SKILL.md short and high-signal; push depth into companion files loaded only on demand.
The full rationale lives in the write-skill skill (../write-skill/SKILL.md) — this is the shape.
-->

One or two sentences: what this skill covers, where it applies in the repo, and where the boundary is
(what a _sibling_ skill owns instead, linked). Lead with the rule, not the preamble.

## When this applies

The concrete situations that should pull this skill in — mirror the `description` triggers. Name real
paths and globs (e.g. "editing `services/platform/convex/**`"). If a sibling skill is the better fit
for an adjacent case, say so and link it.

## The rules

The non-negotiables first, each stated once with its _why_ in the same breath. Where a rule is
enforced by a test/lint, name the guard so the reader trusts it (`enforced by …`); where it isn't,
mark it `reviewer-caught`. Prune as you go (see the meta-standard below).

## Patterns (show, don't tell)

Concrete do/don't, grounded in real files (`path:line` when useful). One good example beats three
sentences of prose. Keep snippets minimal — the smallest code that makes the point.

## Companion files (optional)

Long reference — playbooks, catalogues, per-locale doctrine, worked examples — lives in sibling `.md`
files in this directory, each linked with a one-line "read when". Keep `SKILL.md` itself scannable.

---

## Authoring meta-standard (delete in real skills)

Build the skill to make the agent's _process_ predictable. Then prune it against the five failure
modes — the fix for most is **delete**, not reword:

- **No-ops** — a line the model already obeys by default. Test each sentence: _does it change
  behaviour vs. the default?_ Cut "write clear code", "be careful", "handle errors". If a real rule
  reads weak, sharpen its **leading word** (`be thorough` → `relentless`), don't add a sentence.
- **Duplication** — one meaning, one place. Link the skill that owns a topic; don't restate it.
- **Sediment** — **cite only verified paths.** `ls`/`grep`/run every path and command on the current
  branch before writing it. A stale reference is worse than no reference.
- **Sprawl** — `SKILL.md` ≤ ~150 lines. Progressive disclosure, three tiers: in-skill steps →
  in-skill reference → companion `.md`. Inline what _every_ branch needs; push behind a pointer what
  only _some_ branches reach.
- **Premature completion** — make "done vs. not-done" checkable so the agent can't stop a sequence early.

Plus the structural rules:

- **Frontmatter** = `name` (must equal the directory, dash-case) + `description`. Nothing else — the
  adapter generator parses exactly these two.
- **One concern per skill.** If the name needs "and", it's probably two. Fold a tiny adjacent topic
  into a section rather than spawn a near-empty skill.
- **Invocation axis.** A `.claude/skills/` skill is model-invoked (auto-attaches by globs / surfaces
  by description); a human-typed workflow is a `.claude/commands/` command that delegates to its
  skill. Author a skill only when the agent (or another skill) must reach it on its own.
- **Don't duplicate the ecosystem.** If a built-in/harness skill already does the job (`react-doctor`,
  `code-review`, `claude-api`), reference it; a custom skill must add Tale-specific value.
- **Register it.** Add the skill's row to the index in `/AGENTS.md`, set its globs in
  `.claude/skill-globs.json`, and run `bun .claude/gen-skill-adapters.mjs` — same change. Then
  `bun .claude/check-skill-links.mjs` must pass (links resolve, `name` == dir, index + adapters in sync).
