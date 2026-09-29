---
title: Skill library
description: Create reusable instructions, import a skill bundle, and choose which teams and project agents can use it.
---

A skill packages a repeatable way of working: writing release notes, checking a brief, or preparing a document in your house style. It contains a `SKILL.md` instruction file and, optionally, supporting files. Use **Settings > Skills** to maintain it once, then [equip the agents](/platform/agents/skills) that need it.

Skills take effect where an agent does the work: a [project agent](/platform/projects/project-agents) working a [task](/platform/projects/tasks), or an agent node in an [automation](/platform/automations/concepts). Chat answers questions and searches your knowledge; it does not use skills, run code, or produce files. To get a document made with a skill, assign a task to an agent equipped with it. Any member can create that task in a project they can open; equipping an agent with the skill needs the Editor role or higher.

Every member can create a skill. You can edit your own; editing or deleting another person's shared skill requires an organization administrator. Your organization can reserve sharing with everyone for some roles; see [Who can share with everyone](#who-can-share-with-everyone).

## Create a small skill

<Steps>

<Step title="Name the skill and explain when to use it">

Open **Settings > Skills**, then **Add skill > Blank skill**. Enter a **Name** such as `brief-summary` and a **Description**:

```text
Summarize a project brief into its review date, owner, and open questions.
Use when someone asks for a handover or a quick check of a brief.
```

The name is a unique slug: lowercase letters, digits, and single hyphens, up to 64 characters. The description tells the model when the skill is relevant. Under **Visibility**, choose who sees the skill: **Organization**, or **Teams** with at least one team. Click **Create** to add it and open its editor.

</Step>

<Step title="Write the instructions">

Under **Instructions (body)**, give a short procedure and a recognizable result. For example:

```markdown
Read the supplied brief. Return a table with three rows: review date,
owner, and open questions. Quote the sentence supporting each answer.
Write "Not stated" where the brief supplies no answer. Do not infer a
launch date from a review date.
```

Add reference files only when they help perform the procedure. Keep detailed examples in those files and tell the agent when to open them.

</Step>

<Step title="Choose the audience and save">

**Organization** is preselected when you create a skill, unless your organization reserves it. If the content belongs to a different audience, change it under **Visibility**: **Teams** needs at least one team. Add an icon or labels if they will help people find the skill, then click **Save**.

Creating a skill does not equip an agent automatically. Open the intended project's agent and select the skill in its equipment. Run a small task with a known input and check the result against the instructions.

</Step>

</Steps>

<Frame caption="The skill editor puts bundle files, description, labels, and visibility together, with Instructions below.">

![The docx skill editor shows its bundle file tree, description, labels, Organization visibility, and the Instructions heading.](/images/platform/skill-library-detail.webp)

</Frame>

## Import an existing bundle

Use **Add skill > Upload zip** or **Upload folder**. The bundle must contain `SKILL.md` at its root. References, assets, and scripts can accompany it:

```text
brief-summary/
├── SKILL.md
└── references/
    └── example-brief.md
```

The preview shows metadata, sharing, license, and the file list before **Upload bundle** writes anything. Check the contents and audience. Missing `visibility` means organization-wide sharing. If your organization reserves that and you may not publish, the preview says so and **Upload bundle** stays unavailable; add `visibility: team` and your team IDs to `SKILL.md`. When you create a team skill or change its teams, you may name only your organization's teams, and only your own unless you are an administrator. Keeping an existing team list is allowed even if a team has since been deleted. An `owner` in the file is ignored: a new skill is yours, and a replacement keeps its current owner or becomes yours if it had none. If the name already exists, Tale asks whether to replace that skill; replacement affects the agents that use it.

<Warning>

Importing a skill does not start a task or execute its files. Once equipped, however, its instructions guide a coding agent that may have tools, credentials, and a shell. Review unfamiliar instructions and scripts before equipping the bundle. A skill is not an additional permission boundary.

</Warning>

## Understand sharing

| Visibility | Who can read it | Which project agents can equip it |
| --- | --- | --- |
| **Organization** | Every organization member | Agents in any project |
| **Teams** | Members of the selected teams | Agents in projects with a matching team |

The project's access decides its equipment, even if you personally can read more skills. An organization-wide project can equip organization skills. Legacy private skills remain visible to their owner, but cannot be equipped; new private skills are not accepted.

Narrowing visibility asks for confirmation because some agents may lose access. Deleting a skill has the same practical consequence: runs that require the missing bundle cannot stage it. Check where a shared skill is used before restricting or retiring it.

### Who can share with everyone {#who-can-share-with-everyone}

By default, every member can share a skill with the whole organization. An administrator can reserve this for Editors and above, or for Owners and Admins, under [Skill sharing](/platform/admin/governance/policies-and-limits#skill-sharing), and can let individual members publish with the **Publish skills to the organization** competence. When your organization reserves it and you may not publish:

- **Organization** is unavailable under **Visibility**, and a new skill starts with **Teams**. You can share with your own teams.
- An organization-wide skill you created cannot be changed in place. Narrow it to your teams, with any other change in the same save, or delete it.
- The upload preview flags a bundle that would be shared with the whole organization, one without `visibility` included, and **Upload bundle** stays unavailable.

Skills that were already shared with the organization stay shared.

## See who created and changed a skill

The **Created by** column names the member who created each skill. Search the library for a name to find everything that person shared. The column shows **Built-in** for a skill without a recorded creator, such as the document skills your organization starts with, and **Configuration release** with the member whose upload installed it for a skill a managed configuration release installed. Once the creator leaves the organization, it shows **Former member**.

Open a skill to see **Created by** and **Last edited by**: the member whose save or upload in Tale produced the current version. **Last edited by** is left out when nobody has edited the skill since it was created, or when its file changed outside Tale since the last edit. The skill list in an [agent's equipment](/platform/agents/skills) names the creator under each skill as well.

Tale records creating, editing, uploading and deleting a skill, and every change to its visibility or teams, in the audit log. Administrators and owners find these entries under **Settings > Governance > Logs** in the **Skill** category.

## File reference

A minimal `SKILL.md` looks like this:

```markdown
---
name: brief-summary
description: Summarize a project brief. Use for brief handovers and checks.
visibility: org
---

Read the supplied brief. Report its review date, owner, and open questions.
Quote supporting text and mark missing information as "Not stated".
```

| Field | Meaning |
| --- | --- |
| `name` | Matches the bundle's folder name. `anthropic` and `claude` are reserved. |
| `description` | When and why the model should read the skill; maximum 1,024 characters. |
| `visibility` / `teams` | `org`, or `team` with the team IDs. The UI fills these in for you. |
| `owner` | The user ID of the member who created the skill. Tale sets it; a value in an uploaded file is ignored. |
| `license` | The terms supplied by the author. |
| `recommended-packages` | Suggested dependencies; importing does not install them. |
| `disable-model-invocation` | Requests explicit use of the skill. Treat this metadata as an instruction, not an access restriction. |
| `icon` / `labels` | Library presentation; up to eight labels. |

Tale preserves unrecognized frontmatter keys. The frontmatter limit is 16 KB and the complete `SKILL.md` limit is 512 KB. Keep frequently read instructions much smaller than these ceilings.

## Update and troubleshoot

Open a row to edit its description, instructions, labels, and visibility. The **Bundle** tree lets you inspect supporting files. Changes are not pinned per agent: later staging uses the current bundle, so test shared changes with a representative task.

If an agent cannot find the skill, check that it is equipped and visible to the project. Tale shows the agent a description excerpt of up to 300 characters to help it choose a relevant skill, so start the description with when the skill applies. If it ignores an equipped skill, name the skill in the task and check the result against its instructions. Read [Skills on agents](/platform/agents/skills) for how the equipped bundle is staged and presented to the agent.

For an import error, check that `SKILL.md` is at the root, its frontmatter is valid, and its name is a valid slug. The error names rejected paths or size limits. To retire a bundle, open it and choose **Delete skill** after checking the affected agents.
