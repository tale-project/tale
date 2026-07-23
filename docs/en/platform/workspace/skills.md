---
title: Skill library
description: The organization's skill library — file-based bundles any agent can read at runtime, kept by one member or shared with everyone through a single field.
---

A skill is an instruction you write once and let every chat and every agent read. It lives in your organization's own file tree as a small bundle — a `SKILL.md` carrying the instruction in its body, plus any reference material that instruction leans on — and the library under **Settings > Skills** is where you create, upload, and maintain those bundles. Managing the library takes Admin or Developer permissions.

This page covers what a skill is, the file it is made of, who gets to see it, and how you add, copy, and retire one. Read the agent side on [Agent skills](/platform/agents/skills) once you want a particular agent to reach for a particular bundle.

## What a skill is, and what it is not

A skill is a **knowledge pack**. Its body is instruction a model reads when the work calls for it: a house writing voice, a checklist your team follows, the way your organization phrases a refusal. A model finds the bundle by its description, expands the body when that description matches the task at hand, and opens individual bundle files when the body points at them.

A skill is never something the platform executes. There is no entry point, no command, and no runtime in a bundle — a file under `scripts/` is material a model may read and adapt, not a program Tale runs on your behalf. That boundary is what makes a bundle safe to accept from outside: importing someone else's skill hands your organization prose and reference files, and nothing that can act on its own.

## The SKILL.md file

Every bundle has exactly one `SKILL.md` at its root — a YAML frontmatter block, then the instruction body in markdown.

```markdown
---
name: release-notes
description: Turn a list of merged changes into release notes in our house voice. Use when someone asks for a changelog, release notes, or a summary of what shipped.
visibility: org
license: CC-BY-4.0
recommended-packages:
  python:
    - markdown-it-py
---

Write release notes as three sections — Added, Changed, Fixed — and lead each
line with the verb...
```

The keys follow the agentskills.io convention in kebab-case, and any key Tale does not recognise is kept verbatim, so a bundle authored for another tool survives an edit and a save unchanged.

| Key                        | What it carries                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                     | The slug, which must equal the bundle's folder name — lowercase letters, digits, and single hyphens, 64 characters at most. `anthropic` and `claude` are reserved. |
| `description`              | Up to 1024 characters, and the field that decides whether a model reaches for the skill at all. Say what it does and when it applies.                              |
| `visibility`               | `private` or `org`. Absent counts as `org`.                                                                                                                        |
| `owner`                    | The member the bundle belongs to. Required on a `private` skill; on an `org` skill it is attribution.                                                              |
| `license`                  | Free text, for a bundle you imported or intend to pass on.                                                                                                         |
| `recommended-packages`     | Python or Node package specs the author suggests. Advisory only — Tale never installs them on a skill's behalf.                                                    |
| `disable-model-invocation` | Set it to `true` and a model must not reach for the skill on its own. It stays available for an explicit recall.                                                   |
| `icon` and `labels`        | An Iconify id and up to eight chips, for the skill's card in the library.                                                                                          |

Two ceilings apply: the frontmatter block may run to 16 KB, and the whole `SKILL.md` to 512 KB. Bundle assets sit outside that budget.

## Who can see it

Sharing is one field rather than a table of permissions. `visibility: private` means only the bundle's `owner` sees it in the library, which is why a private skill has to name one. `visibility: org` means every member does. There is no scope hierarchy underneath that: sharing a skill is an edit that flips `visibility` to `org`, and taking it back flips it to `private` again.

<Note>

A bundle carrying no `visibility` at all counts as an organization skill. An unmarked bundle landed in the organization's tree deliberately — a community import, a copy of a built-in — so treating it as private would hide it from everybody at once.

</Note>

## Add a skill to the library

Open **Settings > Skills**. **Add skill** offers two starting points, and **Upload skill** sits beside it for a bundle you already have.

<Steps>

<Step title="Start blank or from a template">

**Blank** asks only for a name — the slug, in lowercase letters, numbers, and single hyphens — and drops you into an empty bundle. **From template** opens **New skill from template**, where you pick one of the built-in skills and get a copy that is yours to edit.

</Step>

<Step title="Or upload a bundle">

**Upload skill** opens **Upload skill bundle**. Drop a `.zip` with `SKILL.md` at its root, alongside any `scripts/`, `references/`, or `assets/` folders. Tale reads the frontmatter before writing anything and shows you what it found — the description, the license, the recommended packages, and a count of the extra keys it will preserve — so you approve a bundle you have actually read. A zip whose slug already exists asks first whether to replace it.

</Step>

<Step title="Write the body">

Open the skill and write the instruction under **Instructions (body)**. This is the text a model reads, so write it the way you would brief a colleague: what the skill is for, when it applies, and what good output looks like.

</Step>

</Steps>

## Copy, replace, and retire

Each skill's menu carries **View details**, **Duplicate**, and **Delete skill**; the detail view adds **Replace bundle**.

**Duplicate** forks the bundle under a new slug — reach for it when you want to vary a shared skill without disturbing the original. **Replace bundle** overwrites a bundle's contents in place and keeps the slug, so every agent bound to it picks up the new text from its next request. **Delete skill** removes the bundle from disk; any agent bound to it loses access, and the binding falls back to nothing.

<Warning>

Replacing and deleting both take effect immediately, and there is no version pinning. An agent bound to a skill always reads the bundle exactly as it stands right now.

</Warning>

## What sits in the bundle

The detail view shows **Bundle** — the file tree as it exists on disk — with a viewer for any file you click. The smallest useful skill is a single file, and most grow one folder at a time.

```text
release-notes/
├── SKILL.md
├── references/
│   └── voice-and-tone.md
└── scripts/
    └── group-changes.py
```

Keep the assets small and readable. Text a model can open cheaply gets used; a large binary sits there unread, and the viewer says outright that it cannot preview it. **Recent changes** on the same view is the bundle's audit trail — who uploaded, duplicated, updated, or deleted it, and when — and it is the first place to look when a skill starts behaving differently from the last time you reached for it.

## Where this fits

The skill library is the lightest reuse Tale offers: one file, one field for sharing, and nothing to keep in sync across the people who need it. It is where a phrasing you keep retyping stops being something you retype. Once a bundle is in the library, the remaining decision is which agent should reach for it — that is [Agent skills](/platform/agents/skills), which covers binding, the ceiling on how many one agent may hold, and how a bundle reaches a sandbox.
