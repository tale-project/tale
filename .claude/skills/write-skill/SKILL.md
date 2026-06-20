---
name: write-skill
description: How to author or edit a skill under .claude/skills/ so the set stays consistent, discoverable, and free of stale paths. Read before adding, rewriting, splitting, or merging a skill — covers the description-as-invocation rule, the canonical SKILL.md skeleton, progressive disclosure, the five failure modes to prune against, leading words, and the AGENTS.md index + skill-globs registration every skill ships with.
---

# write-skill

A skill exists to wrangle determinism out of a stochastic system — so the agent runs the **same
process** every time, not so it emits the same output. Predictability is the root virtue; every rule
below serves it. A sloppy skill (stale paths, a vague description, 400 inline lines) is worse than
none. Copy [`SKILL_TEMPLATE.md`](../SKILL_TEMPLATE.md) for the shape; this skill is the why.

## The description does the invocation work

The agent decides whether to load a skill from its `description` alone — so the description gets
_harder_ pruning than the body.

- **Front-load the leading word.** Open with the capability (`How to … / The contract for …`), then
  `Read before …` and the concrete triggers — the paths, verbs, and symptoms someone uses when they
  need it. The **first sentence must stand alone**: the generated Cursor/Copilot adapters surface
  only that sentence.
- **One trigger per branch.** Name distinct situations, not synonyms for one. Adjectives aren't triggers.
- **Say nothing the body repeats.** Identity, rationale, and how-to belong in the body.

## The shape (copy the template)

`SKILL.md` ≤ ~150 lines, scannable in seconds:

1. **Frontmatter** — `name` (== directory, dash-case) + `description`. Nothing else (the adapter
   generator parses exactly these two).
2. **Opener** (1–2 sentences) — what it covers + the boundary, linking the sibling that owns the
   adjacent case. Lead with the rule, not preamble.
3. **`## When this applies`** — mirror the description triggers; name real globs.
4. **`## The rules`** — non-negotiables, each with its _why_ in the same breath. Name the guard that
   enforces it (`enforced by …`) or mark it `reviewer-caught`.
5. **`## Patterns`** — minimal real do/don't, `path:line` when it helps. The smallest snippet that
   makes the point.
6. **`## Companion files`** (only when depth warrants) — each with a one-line "read when".

## Progressive disclosure — three tiers

Rank every line by immediacy: **in-skill steps** (what every run needs) → **in-skill reference**
(rules + patterns) → **external pointer** (a companion `.md` or a sibling skill). Inline what _every_
branch needs; push behind a pointer what only _some_ branches reach. Keep a concept's definition,
rules, and caveats co-located under one heading — don't scatter it.

## Prune against the five failure modes

Audit every skill — new or edited — against these. The fix for most is **delete**, not reword.

- **No-ops** — a line the model already obeys by default. Test each sentence: _does it change
  behaviour vs. the default?_ "Write clear names", "handle errors", "be careful" all fail — cut them.
  If a real rule reads weak, sharpen its **leading word** (`be thorough` → `relentless`); don't add a
  sentence.
- **Duplication** — one meaning in two places. Pick the owner skill; everyone else links it
  (`../<skill>/SKILL.md`). One edit, one place.
- **Sediment** — stale layers that accreted because adding felt safe and removing felt risky. **Cite
  only verified paths**: `ls`/`grep`/read every path and command on the current branch before writing
  it. A stale reference is worse than no reference.
- **Sprawl** — long even when every line is live and unique. Disclose reference behind a pointer;
  split only when the cut earns it.
- **Premature completion** — the agent stops a sequence early. First sharpen the completion criterion
  so done-vs-not-done is checkable; only split to hide later steps if the rush survives a sharp
  criterion.

## Leading words

A leading word is a compact concept the model already thinks with — it anchors behaviour _and_
invocation in fewer tokens. Collapse a restated phrase into one: "fast, deterministic, low-overhead"
→ _tight_. Reach for a sharper word before you reach for another sentence.

## One concern; mind the invocation axis; don't duplicate the ecosystem

If the name needs "and", it's two skills — fold a tiny adjacent topic into a section rather than spawn
a near-empty skill. **Invocation axis:** a [`.claude/skills/`](../) skill is _model-invoked_ — it
auto-attaches by [`skill-globs.json`](../../skill-globs.json) or surfaces by its description; a
human-typed workflow is a [`.claude/commands/`](../../commands/) command (`/qa`, `/ship`, `/verify`)
that _delegates_ to its skill. Author a skill only when the agent (or another skill) must reach it on
its own. And if a built-in/harness skill already does the job (`react-doctor`, `code-review`,
`claude-api`), reference it — a custom skill must add Tale-specific value.

## Register it — non-negotiable

Adding a skill means **adding its row to the skill index in [`/AGENTS.md`](../../../AGENTS.md)**;
removing one removes that row; renaming updates it. The index is the map every agent reads — if it
lies, agents load the wrong thing. Then set the skill's file globs in
[`skill-globs.json`](../../skill-globs.json) (empty array = activity-scoped) and regenerate the
cross-tool adapters with `bun .claude/gen-skill-adapters.mjs`. Same change, every time.

## After writing

Run [`.claude/check-skill-links.mjs`](../../check-skill-links.mjs): it fails on a dead link, a `name`
≠ directory, an index out of sync, a missing globs entry, or stale adapters. A skill ships only when
it passes.
