---
name: write-skill
icon: lucide:graduation-cap
labels: ['Authoring']
description: 'Use this skill whenever you create or update a skill in a Tale organization — a SKILL.md bundle that teaches agents a capability or procedure. Triggers include: "write/add a skill", "teach the agent to …", "package this procedure so agents can reuse it", or an agent that keeps needing the same instructions. Never author a SKILL.md without it — and never create one before listing the existing skills and ruling out reuse. To make an agent load a skill, bind it via skillBindings (write-agent); to ship skills inside an installable bundle, use write-automation.'
---

# write-skill

A skill is a bundle directory `skills/<slug>/` with a `SKILL.md` at its root plus optional assets
(scripts, reference files). Agents see a skill only when their `skillBindings` list its slug (max
10 per agent — there is no implicit "all skills"); the description alone decides whether the agent
loads it, so the description carries the invocation.

## Reuse before you create — tick every box

- [ ] List the existing skills of the org first.
- [ ] One already covers the capability → bind it to the agent; create nothing.
- [ ] One covers it partially → extend that bundle instead of writing a near-twin.
- [ ] Nothing fits → only then author a new bundle.

## Frontmatter — the validated contract

`SKILL.md` must **open** with a strict-YAML frontmatter block fenced by `---` lines (≤16 KB):

- `name` (required) — must equal the bundle directory slug: kebab-case
  `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤64 chars. `anthropic` and `claude` are reserved and rejected.
- `description` (required, 1–1024 chars) — the invocation. Open with
  `Use this skill whenever <situation> …`, enumerate the concrete triggers, close with the
  boundary (which sibling skill owns the adjacent case).
- Optional: `license` (≤120 chars); `recommended-packages` with `python`/`node` spec lists (≤20
  each, ≤120 chars per spec — advisory only, never auto-installed);
  `disable-model-invocation: true` (the skill is never auto-loaded; explicit recall only);
  `icon` (an Iconify `set:name` like `lucide:book-open`, shown on the catalog card);
  `labels` (≤8 literal display chips like `["Documents"]`, shown on the catalog card — the same
  vocabulary automation manifests use); `metadata` (free-form record). Unknown keys are
  preserved, not rejected.

```markdown
---
name: triage-inbox
description: Use this skill whenever you triage incoming support email — classify, route, and draft a reply. Never answer a support thread without it.
---

# triage-inbox

1. Classify the message: bug / billing / question.
2. ...
```

## Body — keep it a procedure

- Imperative steps the agent runs the same way every time; ≤ ~150 lines. Push depth into companion
  files inside the bundle and link them with a one-line "read when".
- Cut lines the model already obeys by default ("be careful", "write clear names") — every sentence
  must change behaviour.
- Scripts live in the bundle (e.g. `scripts/convert.py`) and are invoked bundle-relative.

## Limits and validation

- Bundle caps: ≤2 MiB per file, ≤20 MiB decompressed total, ≤200 entries.
- Malformed frontmatter (missing fence, invalid YAML, failed field) is rejected at upload/save as
  `invalid_frontmatter` with the offending line — nothing broken ever lands in the org.

Siblings: `write-agent` (binding skills to agents), `write-workflow` (processes, not capabilities),
`write-automation` (shipping a bundle of entities as one installable automation).
