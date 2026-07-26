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

Open **Settings > Skills**. **Add skill** asks for a name — the slug, in lowercase letters, numbers, and single hyphens — and a description, and drops you into the new bundle's page. Write the instruction under **Instructions (body)**: this is the text a model reads, so write it the way you would brief a colleague — what the skill is for, when it applies, and what good output looks like.

Bundles also arrive without being typed in here at all: an automation package uploaded as a zip installs the skills it carries straight into this library, with a confirmation in front of any existing skill it would replace. That flow — and how a package declares its skills — lives on [Add automations to your organization](/platform/automations/catalog).

## Replace and retire

Replacing a bundle's contents happens through the same package upload: a carried skill whose slug already exists asks for confirmation, then swaps the whole bundle and keeps the superseded `SKILL.md` in the skill's history. **Delete** on the skill's own page removes the bundle from disk; any agent bound to it loses access, and the binding falls back to nothing.

<Warning>

Replacing and deleting both take effect immediately, and there is no version pinning. An agent bound to a skill always reads the bundle exactly as it stands right now.

</Warning>

## What sits in the bundle

The skill's page shows **Bundle** — the file tree as it exists on disk, with `SKILL.md` pinned at the top — and clicking any file opens it read-only beside the tree: code with syntax highlighting, markdown rendered, and a plain notice for an image or a binary the browser cannot preview. `SKILL.md` itself brings back the editing form, whose body offers an **Edit** / **Preview** toggle — preview renders the markdown exactly as a reader sees it. The smallest useful skill is a single file, and most grow one folder at a time.

```text
release-notes/
├── SKILL.md
├── references/
│   └── voice-and-tone.md
└── scripts/
    └── group-changes.py
```

<Frame caption="A skill's page — the bundle's file tree on the left, the selected file read-only on the right.">

![A skill's detail page showing the bundle file tree with SKILL.md pinned and a script file open in the read-only viewer.](/images/platform/skills-bundle-tree.webp)

</Frame>

Keep the assets small and readable. Text a model can open cheaply gets used; a large binary sits there unread, and the viewer says outright that it cannot preview it.

## Where this fits

The skill library is the lightest reuse Tale offers: one file, one field for sharing, and nothing to keep in sync across the people who need it. It is where a phrasing you keep retyping stops being something you retype. Once a bundle is in the library, the remaining decision is which agent should reach for it — that is [Agent skills](/platform/agents/skills), which covers binding, the ceiling on how many one agent may hold, and how a bundle reaches a sandbox.
