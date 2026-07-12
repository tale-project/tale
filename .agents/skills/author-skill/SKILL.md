---
name: author-skill
description: Use this skill whenever you author, edit, rewrite, split, merge, or move a skill — a Tale-specific repo-dev guide under .agents/skills/, a generic workflow skill whose source of truth is builtin-configs/skills/ and is projected into .agents/skills/, or a product-only skill under builtin-configs/skills/. It covers the description-as-invocation rule, the canonical SKILL.md skeleton, progressive disclosure, the five failure modes to prune against, leading words, which home a skill belongs in, and the AGENTS.md index + WORKFLOW_SKILLS allowlist + sync every skill ships with. Load it before touching any SKILL.md, and never hand-edit a generated .claude/skills mirror or a projected .agents/skills copy.
---

# author-skill

A skill exists to wrangle determinism out of a stochastic system — so the agent runs the **same
process** every time, not so it emits the same output. Predictability is the root virtue; every rule
below serves it. A sloppy skill (stale paths, a vague description, 400 inline lines) is worse than
none. Copy [`SKILL_TEMPLATE.md`](../SKILL_TEMPLATE.md) for the shape; this skill is the why.

## Write a note first

**Invoke `write-notes`** and record your answers to this form before you author or edit the skill:

- **Skill & home:** Describe the skill, the home it belongs in (`.agents/skills` vs `builtin-configs/skills`), and the single concern it owns.
- **Invocation:** Describe its directive description — the situation and triggers that should make the agent load it.
- **Overlap:** Describe what existing skill or section it overlaps and how you'll reuse or fold rather than duplicate.
- **Risks & unknowns:** Describe where this skill might mislead an agent or collide with another, and how you checked.

## The description does the invocation work

The agent decides whether to load a skill from its `description` alone — so it gets _harder_ pruning
than the body, and it must **command the agent into the skill** in the right situation, not merely
describe it. A description that reads like a summary gets skipped; one that names the trigger and
enforces the skill wins.

- **Lead with the directive + the situation.** Open `Use this skill whenever <concrete situation> …`
  (or `Read before <trigger> …`) — the capability _and_ the command to load it, in a **first sentence
  that stands alone** (a terse harness listing may show only it).
- **Enumerate the triggers exhaustively, one per branch.** The real file paths, verbs, and symptoms
  someone hits when they need it (`"fix"`, a pasted stack trace, editing `convex/**`). Distinct
  situations, not synonyms; adjectives aren't triggers. Over-cover rather than under-cover — a missed
  trigger is a skipped skill.
- **Enforce it.** Close with the boundary (the sibling that owns the adjacent case — _for a defect, use_
  `fix-bug`) and a "never do X without it" clause, so the agent can't default to a generic approach in
  the skill's situation.
- **Say nothing the body repeats.** Identity, rationale, and how-to belong in the body.

## The shape (copy the template)

`SKILL.md` ≤ ~150 lines, scannable in seconds:

1. **Frontmatter** — `name` (== directory, dash-case) + `description`. Nothing else (that is all
   every harness reads).
2. **Opener** (1–2 sentences) — what it covers + the boundary, linking the sibling that owns the
   adjacent case. Lead with the rule, not preamble.
3. **`## When this applies`** — mirror the description triggers; name real globs.
4. **`## The rules`** — non-negotiables, each with its _why_ in the same breath. Name the guard that
   enforces it (`enforced by …`) or mark it `reviewer-caught`.
5. **`## Patterns`** — minimal real do/don't, `path:line` when it helps. The smallest snippet that
   makes the point.
6. **`## Companion files`** (only when depth warrants) — each with a one-line "read when".

Where a skill has a **done-gate or a must-not-skip sequence** (a "before you call it done", a pre-flight
gate), write it as a **true `- [ ]` checklist** opened with "tick every box, or N/A with a reason; an
unticked box means not done". A box the agent fills in beats a paragraph it skims (see _Premature
completion_).

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
- **Premature completion** — the agent stops a sequence early. Make done-vs-not-done a **true `- [ ]`
  checklist it must tick** — each box a verifiable assertion, N/A allowed with a reason; only split to
  hide later steps if the rush survives a sharp checklist.

## Leading words

A leading word is a compact concept the model already thinks with — it anchors behaviour _and_
invocation in fewer tokens. Collapse a restated phrase into one: "fast, deterministic, low-overhead"
→ _tight_. Reach for a sharper word before you reach for another sentence.

## One concern; mind the invocation axis; don't duplicate the ecosystem

If the name needs "and", it's two skills — fold a tiny adjacent topic into a section rather than spawn
a near-empty skill. **Invocation axis:** a [`.agents/skills/`](../) skill is _model-invoked_ — it
surfaces by its description, and may also be human-invoked by name (`/fix-bug`, `/create-pr`,
`/review-pr`) — these invocable workflows are themselves skills, not separate command files. Author a skill only when the agent (or another skill) must reach it on
its own. And if a built-in/harness skill already does the job (`react-doctor`, `code-review`,
`claude-api`), reference it — a custom skill must add Tale-specific value.

## Homes — pick by audience

Decide who runs the skill, then pick its source of truth — three cases:

- **Repo-dev guide** (Tale-specific, docs only) → [`.agents/skills/<name>/`](../). The source every
  coding agent reads; `skills:sync` mirrors it into `.claude/skills/` for Claude Code. May use repo
  paths and link siblings by file. `author-skill` and `write-translations` live here.
- **Generic workflow skill** (a senior-dev workflow that ALSO ships to product org agents) → source of
  truth under [`builtin-configs/skills/<name>/`](../../../builtin-configs/skills/), with its name in the
  `WORKFLOW_SKILLS` allowlist in [`tools/skills/src/sync.ts`](../../../tools/skills/src/sync.ts).
  `skills:sync` **projects** it into `.agents/skills/<name>/` and on to `.claude/skills/`. Because it
  ships to agents working on _any_ codebase, it must be **generic and portable** — no repo paths, no
  Tale rule names; cross-reference siblings by slug in prose, never by file link. `implement-feature`,
  `fix-bug`, … live here.
- **Product-only skill** → `builtin-configs/skills/<name>/` (document skills like `pptx`, the
  org-entity authoring skills `write-agent`/`write-workflow`/`write-skill`/`write-integration`/
  `write-automation`, and the Bun-workspace `visual-aspect-analyzer` — all embedded in the CLI
  binary and seeded per-org identically). Not projected into the guides. `visual-aspect-analyzer`
  is additionally baked into the sandbox image
  ([`services/sandbox-runtime/Dockerfile`](../../../services/sandbox-runtime/Dockerfile)) with its
  deps installed, and that baked copy wins in sandbox sessions. (The product `write-skill` teaches
  ORG agents to author org skills; this repo-dev standard is `author-skill` — two different
  audiences, two skills.)

**Never hand-edit a generated copy.** `.claude/skills/<name>/` is a mirror; `.agents/skills/<workflow>/`
is a projection of its `builtin-configs/skills/` source — edit the source, then `bun run skills:sync`.
Scaffold any home with `bun run gen skill` (it prompts for the category). A shipped skill may carry
runnable code in `<skill>/scripts/`, invoked skill-relative (`bun scripts/<name>.ts` /
`python scripts/<name>.py`); bun scripts must be self-contained (only `node:*`, `bun`/`bun:*`, relative
imports — `skills:check` enforces it).

## Register it — non-negotiable

Adding a skill means **adding its row to the skill index in [`/AGENTS.md`](../../../AGENTS.md)**;
removing one removes that row; renaming updates it. The index is the map every agent reads — if it
lies, agents load the wrong thing. A **generic workflow skill** also needs its name in the
`WORKFLOW_SKILLS` allowlist in [`tools/skills/src/sync.ts`](../../../tools/skills/src/sync.ts) so it
projects into the guides. Then run `bun run skills:sync` (the
[`@tale/skills`](../../../tools/skills/) tool) to regenerate every projection and the `.claude/skills/`
mirror. Same change, every time.

## Before the skill ships — tick every box

- [ ] **Frontmatter is `name` (== directory, dash-case) + `description` only** — nothing else.
- [ ] **The description commands the agent into the skill** — directive opener (`Use this skill whenever …`), exhaustive triggers, an enforcement / boundary clause, first sentence standing alone.
- [ ] **Pruned against the five failure modes** — no no-ops, no duplication, every cited path verified on this branch, ≤ ~150 lines, and any done-gate written as a true `- [ ]` checklist.
- [ ] **Registered** — its row is in the [`/AGENTS.md`](../../../AGENTS.md) index (and, for a workflow skill, its name is in `WORKFLOW_SKILLS`).
- [ ] **`bun run skills:sync` run**, and the regenerated `.claude/skills/` mirror (+ any projection) committed.
- [ ] **`bun run skills:check` passes** — no drift, every shipped `SKILL.md` script ref resolves, bun scripts self-contained.
