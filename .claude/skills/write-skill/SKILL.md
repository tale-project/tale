---
name: write-skill
description: How to author or edit a skill under .claude/skills/ so the set stays consistent and discoverable. Read before adding a new skill, editing an existing one, or splitting/merging skills. Codifies frontmatter, progressive disclosure, path accuracy, and the rule that the AGENTS.md skill index must stay in sync.
---

# write-skill

Skills are how depth stays out of the always-loaded contract while remaining one trigger away. A
sloppy skill (stale paths, vague description, 400 inline lines) is worse than none. The full
authoring standard is [`SKILL_TEMPLATE.md`](../SKILL_TEMPLATE.md) — copy it; this skill is the why.

## The standard

- **Frontmatter = `name` + `description`.** `name` must equal the directory name (dash-case). The `description` is all the agent sees when deciding to load the skill, so pack it with **real triggers** — the verbs, file paths, and symptoms someone would use when they need it — not adjectives. Start with the capability, then "Read before …".
- **Progressive disclosure.** `SKILL.md` ≤ ~150 lines, scannable. Push long reference (playbooks, catalogues, per-locale doctrine, worked examples) into companion `.md` files linked with a one-line "read when". Don't inline a reference manual.
- **One concern per skill.** If the name needs "and", it's two skills. Fold a tiny adjacent topic into a section instead of spawning a near-empty skill.
- **Cite only verified paths.** Every path and command must exist on the current branch — `ls`/`grep`/run before writing it. Stale references are the failure this whole rewrite fixed; they're worse than no reference. Drop or generalize anything you can't confirm.
- **Lead with rules + rationale,** then a tight `Patterns` section with minimal real snippets (the smallest code that makes the point). Match the house style of [`convex`](../convex/SKILL.md) (the exemplar).
- **Link siblings, don't duplicate them.** Point to the skill that owns a topic; cross-links use `../<skill>/SKILL.md`. Repo files use the correct relative depth (`../../../` to repo root from a skill file).
- **Don't duplicate the ecosystem.** If a built-in/harness skill already does the job (`react-doctor`, `code-review`, `claude-api`), reference it; a custom skill must add Tale-specific value.

## Register it — non-negotiable

Adding a skill means **adding its row to the skill index in [`/AGENTS.md`](../../../AGENTS.md)**;
removing a skill means removing that row; renaming means updating it. The index is the map every
agent reads — if it lies, agents load the wrong thing or miss the right one. Update it in the same
change.

## After writing

Run the link check ([`.claude/check-skill-links.mjs`](../../check-skill-links.mjs)) so no
relative link is dead, and confirm the frontmatter parses. A skill ships only when its links resolve
and its index row exists.
