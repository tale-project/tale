---
title: Skill library
description: The Skills settings page — file-based bundles your agents read, created by any member and shared with teams or across the organization.
---

A skill is an instruction you write once and let every agent read. It lives in your organization's own file tree as a small bundle — a `SKILL.md` carrying the instruction in its body, plus any reference material that instruction leans on — and **Settings > Skills** is where you create, upload, and maintain those bundles. Every member can create skills; what you may edit is decided per bundle.

This page covers what a skill is, the file it is made of, who gets to see it, and how you add and retire one. Read the agent side on [Skills on agents](/platform/agents/skills) once you want a particular agent to reach for a particular bundle.

## What a skill is, and what it is not

A skill is a **knowledge pack**. Its body is instruction a model reads when the work calls for it: a house writing voice, a checklist your team follows, the way your organization phrases a refusal. A model finds the bundle by its description, reads the body when that description matches the task at hand, and opens individual bundle files when the body points at them.

A skill is never something the platform executes. There is no entry point, no command, and no runtime in a bundle — a file under `scripts/` is material a model may read and adapt, not a program Tale runs on your behalf. That boundary is what makes a bundle safe to accept from outside: importing someone else's skill hands your organization prose and reference files, and nothing that can act on its own.

## The SKILL.md file

Every bundle has exactly one `SKILL.md` at its root — a YAML frontmatter block, then the instruction body in markdown.

```markdown
---
name: release-notes
description: Turn a list of merged changes into release notes in our house voice. Use when someone asks for a changelog, release notes, or a summary of what shipped.
visibility: team
teams:
  - jx7d…
license: CC-BY-4.0
---

Write release notes as three sections — Added, Changed, Fixed — and lead each
line with the verb...
```

The keys follow the agentskills.io convention in kebab-case, and any key Tale does not recognise is kept verbatim, so a bundle authored for another tool survives an edit and a save unchanged.

| Key                        | What it carries                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                     | The slug, which must equal the bundle's folder name — lowercase letters, digits, and single hyphens, 64 characters at most. `anthropic` and `claude` are reserved. |
| `description`              | Up to 1024 characters, and the field that decides whether a model reaches for the skill at all. Say what it does and when it applies.                              |
| `visibility`               | `team` or `org`. Absent counts as `org`. `private` is retired — a pre-existing private bundle still parses, but no new skill may take it.                          |
| `teams`                    | The team ids a `team` skill is shared with — required there, rejected elsewhere. The library's sharing picker fills it for you.                                    |
| `owner`                    | The member the bundle belongs to — attribution on a shared skill, required on a legacy `private` one.                                                              |
| `license`                  | Free text, for a bundle you imported or intend to pass on.                                                                                                         |
| `recommended-packages`     | Python or Node package specs the author suggests. Advisory only — Tale never installs them on a skill's behalf.                                                    |
| `disable-model-invocation` | Set it to `true` and a model must not reach for the skill on its own. It stays available for an explicit recall.                                                   |
| `icon` and `labels`        | An Iconify id and up to eight chips, for the skill's card in the library.                                                                                          |

Two ceilings apply: the frontmatter block may run to 16 KB, and the whole `SKILL.md` to 512 KB. Bundle assets sit outside that budget.

## Who can see it

Sharing is one field rather than a table of permissions. `visibility: team` shares the bundle with the teams listed under `teams` — pick them in the library's **Visibility** section. `visibility: org` means every member sees it, and any project's agents can equip it. Any member may share a skill team- or organization-wide; editing or deleting someone else's shared skill takes an org admin. A bundle carrying no `visibility` at all — including one you upload — counts as an organization skill, and the upload preview says so before you confirm.

<Note>

`visibility: private` is retired. Agents are the only surface that equips skills, and a project's agents never see one member's private bundle — so a private skill would be visible to you alone and usable nowhere. A bundle that already carries it keeps working for its owner (even an admin cannot read it), and its owner can widen the sharing at any time; new skills and uploads that declare `private` are refused.

</Note>

Narrowing a skill's sharing — org to team, or dropping a team — asks for confirmation first: whoever loses sight of the skill also loses it in every agent that equipped it through them.

## Add a skill

Open **Settings > Skills**. The page is a table of every skill you may see — its name, description, visibility, and labels — with search over all three of name, description and labels, and filters for visibility and label. Clicking a row opens the bundle. **Add skill** offers three starting points.

<Steps>

<Step title="Start blank">

**Blank skill** asks for a name — the slug, in lowercase letters, numbers, and single hyphens — plus the description, the sharing, and an instruction body you can write on the spot. New skills start shared with the organization; narrow the sharing to teams where the knowledge is theirs.

</Step>

<Step title="Or upload a bundle">

**Upload zip** takes a `.zip` with `SKILL.md` at its root, alongside any `scripts/`, `references/`, or `assets/` folders; **Upload folder** takes the folder itself and zips it for you. Either way Tale reads the frontmatter before writing anything and shows you what it found — the description, the sharing it will land with, the license, and a full file list with sizes — so you approve a bundle you have actually read. A bundle whose slug already exists asks first whether to replace it.

</Step>

<Step title="Write the body">

Open the skill and write the instruction under **Instructions (body)**. This is the text a model reads, so write it the way you would brief a colleague: what the skill is for, when it applies, and what good output looks like.

</Step>

</Steps>

## What sits in the bundle

A skill's detail view shows **Bundle** — the file tree as it exists on disk — with a viewer for any file you click. The smallest useful skill is a single file, and most grow one folder at a time.

```text
release-notes/
├── SKILL.md
├── references/
│   └── voice-and-tone.md
└── scripts/
    └── group-changes.py
```

Keep the assets small and readable. Text a model can open cheaply gets used; a large binary sits there unread, and the viewer says outright that it cannot preview it.

## Retire a skill

**Delete skill** on the detail view removes the bundle from disk; every agent equipped with it loses access, with nothing to fall back on. There is no version pinning — a skill is always read exactly as it stands right now, which is also what makes it worth extracting: one edit reaches everyone who holds it.

## Where this fits

The skill library is the lightest reuse Tale offers: one file, one field for sharing, and nothing to keep in sync across the people who need it. It is where a phrasing you keep retyping stops being something you retype. Once a bundle is in the library, the remaining decision is which agents get it — that is [Skills on agents](/platform/agents/skills), which covers equipping a project's agents and how a bundle reaches a sandbox.
