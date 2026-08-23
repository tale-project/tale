---
title: Add automations to your organization
description: Where automations come from — the shipped packs every organization starts with, drafts you author on the canvas, and uploaded packages, including zips that install the skills they carry.
---

The **Automations** page in the sidebar lists every automation the organization owns and is the door new ones come through. An organization starts with the shipped packs already in place, you can author a new automation from scratch on its canvas, and **Upload package** takes a pack you built elsewhere — as plain files, or as one zip that also installs the skill bundles the pack ships with. Managing the page takes Owner, Admin, or Developer permissions; everything an upload creates stays a draft until you deploy it, so nothing running changes because a file landed.

This page covers where automations come from and what an uploaded package may contain. Operating one — the canvas, versions, test runs, deploying — is [The workflow editor](/platform/automations/editor); the model underneath is [Automation concepts](/platform/automations/concepts); what the shipped packs do is [Built-in automations](/platform/automations/builtin).

<Frame caption="The Automations page — every row is one automation with its version count and the version that is live, or Not deployed.">

![The Automations page listing the shipped email and GitHub automations, each row showing its version count and deployment state.](/images/platform/automations-catalog.webp)

</Frame>

## What the list shows

Each row is one automation: its name, how many versions it has, and either the live version or **Not deployed**. The org page lists organization-level automations; an automation that belongs to a project lives on that project's **Automations** tab instead — where an automation appears is decided once, by its first save, and never moves. Click a row to land on the automation's page and work with it as [The workflow editor](/platform/automations/editor) describes.

**New automation** offers two ways to start from scratch: **From a goal** hands your description to the builder, which authors the nodes for you; **Blank (trigger + agent)** scaffolds a one-agent automation you wire yourself — name it, pick the agent's model, and the rest (the prompt, the granted tools and secrets, the trigger) is yours to set on the canvas. The shipped packs need no install step at all: every organization is seeded with them at creation, ready to deploy.

## Upload a package

A pack is a directory: `workflow.yml` (the automation document — required), `automation.yml` (the manifest — optional), and, when the pack ships its own knowledge, one folder per skill under `skills/`.

```text
review-invoices/
├── workflow.yml
├── automation.yml
└── skills/
    └── invoice-rules/
        ├── SKILL.md
        └── references/
            └── checklist-rules.md
```

To upload one, open **Automations**, pick **Upload package** from the **New automation** menu, and choose either form of the same pack:

- **The files** — `workflow.yml`, plus `automation.yml` when the pack ships one. Right for a pack that is only its document.
- **One `.zip` of the pack directory** — required when the pack carries skills, since only the zip can hold their folders. Markdown notes outside `skills/` — a README, a design record — are ignored, as are dotfiles and build leftovers (`__pycache__/`, `node_modules/`), so zip the directory as it is, straight after a test run; the zip stays under 20 MiB.

Pick where the automation installs — the organization, or one project — before you submit. A pack whose manifest declares `scope: project` only installs into a project; an organization-wide upload of one is refused. The choice is not final: installing into a project binds the automation to it, and the **Projects** panel on the automation's page manages the whole set afterwards — bind more projects, or none to serve the whole organization.

<Frame caption="Upload package — the files or one zip, and where the automation installs.">

![The upload package dialog with its file drop zone and the Install into picker set to Organization.](/images/platform/automations-upload-dialog.webp)

</Frame>

The server validates before anything is stored. The document runs through the same engine validation the editor uses — an upload that would not run is refused with the engine's own issues, not saved broken — and the manifest's `subjects` and `settings` blocks become the automation's task contract and [settings forms](#settings-the-pack-declares), exactly as a save from the canvas would set them. What lands is a **draft version** behind the normal deploy gate — nothing triggers run until a version is deployed. The dialog offers the deploy the moment the upload succeeds: make the new version live right there, or pick **Later** and deploy from the automation's page when you're ready.

Uploading an existing automation's pack again appends the next version — the store never overwrites history, so every earlier version stays exactly where it was. Choosing a project as the target also binds the existing automation to that project, on top of whatever projects it already serves.

## Skills the package carries

A zip may ship the skills its document leans on — the bundles an agent node loads or a script step runs from. The manifest must name them, and the declaration is checked in both directions: a `skills/` folder the manifest doesn't declare refuses the upload, and so does a declared slug the zip doesn't carry.

```yaml
# automation.yml
name: Review invoices
skills:
  - invoice-rules
subjects:
  task:
    # …the task contract, unchanged
```

Each carried bundle is validated as a real skill — frontmatter parsed, `name` equal to its folder — and installed into the organization's [skill library](/platform/workspace/skills) the moment the upload is accepted, so the draft's test runs already find them. What happens per slug depends on what the library already holds:

- **New slug** — the bundle is installed.
- **Identical bundle** — nothing is written; the upload reports it unchanged.
- **Different content** — the upload stops and lists the colliding slugs. Confirm to replace them with the package's versions; the superseded `SKILL.md` stays in each skill's history. Nothing — not the automation, not any skill — is written until you confirm.

A document that references a skill the package doesn't carry and the library doesn't hold still uploads — the missing reference comes back as a warning, so a pack can name a skill you install later.

## Settings the pack declares

An automation whose runs read operator-owned configuration — a case profile, a validation policy — can declare it as **settings forms** in the manifest. The platform renders them in the task board's create dialog and saves each form as a flat YAML file in a project folder, so nobody hand-edits a file to configure the automation, and every project keeps its own values.

```yaml
# automation.yml
settings:
  folder: Setup
  forms:
    - file: validation-policy.yaml
      title: Validation policy
      required: true
      fields:
        - key: method
          label: Validation profile
          type: select
          default: strict_rules
          options:
            - value: strict_rules
              label: Strict checklist (standard)
```

A form owns its file: saving rewrites `Setup/validation-policy.yaml` from the form's values, and the form pre-fills from whatever the file holds — whether the form wrote it or someone uploaded it by hand. Fields are `text`, `number`, `boolean`, or `select`; every value lands as a string, a `text` field may pin a `pattern`, and titles, labels, help lines, and option labels localize through per-entry `i18n` blocks. Anything richer than a flat key–value file — nested blocks, lists — belongs in a separate hand-authored file the workflow reads alongside.

Mark a form `required: true` and the create dialog enforces it per project: the first time someone picks the automation's task template in a project that hasn't been set up, the forms appear before the task's own field, and creating continues only once they're saved — one **Save and continue** writes them all. From then on a **Settings** button in the same dialog reopens the forms for editing, as tabs behind a single **Save**: it writes every form you changed, a dot marks tabs with unsaved edits, and closing with unsaved changes asks first.

Some settings are files rather than values — reference documents the runs read as-is. Declare those as an **uploads form** (`kind: uploads`): instead of writing a YAML file, the form manages a project folder, with a drop zone, a folder picker, and a listing of what's already there.

```yaml
# automation.yml
settings:
  folder: Setup
  forms:
    - kind: uploads
      title: Reference documents
      subdir: reference
      accept: ['.pdf', '.json']
      match: '\.(pdf|json)$'
      requireFolder: true
```

`accept` names the extensions the picker offers, `match` filters which file names the panel lists (case-insensitive — and an upload whose name would never match is refused up front, so nothing lands and then "vanishes" from the listing), `subdir` scopes the form to a dedicated subfolder of the settings folder, and `requireFolder: true` makes you pick or create a subfolder before uploading — for material that must stay organised per period or topic instead of piling up at the root. Uploads apply immediately: an uploads form has no **Save**, never gates task creation, and runs read the folder's current contents.

## Deliverables the pack declares

A pack whose runs file documents back into a task's folder can name which of them
are the **deliverables** — what a reviewer opens the task for. The task's Outcome
zone lists exactly these, always open and in the declared order, while everything
else in the folder — the uploads, the run's working files — folds away under
**Files**.

```yaml
# automation.yml
subjects:
  task:
    outcome:
      files:
        - return.xml
        - report.md
        - journal.csv
```

Only the pack knows which of its written files are the point, so nothing is
guessed platform-side: a name that no run has filed yet still shows as a promised
row marked _Not ready yet_, so the task names what it will produce before it
produces it. `*` and `?` wildcards are honoured (`return-*.xml`) for a name a run
derives. A deliverable only some runs produce — an audit roll-up that exists only
for certain projects — is declared as `{ name: audit-summary.md, optional: true }`:
it appears once a run files it, and is never announced as a promise that might
not come. Declare nothing and the Outcome zone falls back to every file the runs
filed, newest first.

## Where this fits

Automations arrive three ways — seeded with the organization, authored on the canvas, or uploaded as a pack — and every route ends in the same place: a draft version on the automation's page, deployed on your say-so. A zip-packed upload also stocks the [skill library](/platform/workspace/skills) with the bundles the automation needs, with a confirmation in front of any skill it would replace. [The workflow editor](/platform/automations/editor) is the next read for taking that draft live.
