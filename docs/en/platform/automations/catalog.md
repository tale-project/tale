---
title: Create or import an automation
description: Choose a starting point, import a validated package and prepare its skills, settings and deliverables before deployment.
---

Open **Automations** to find the workflows available in your organization. Owner, Admin and Developer roles can manage them. Start with a [built-in automation](/platform/automations/builtin) when it matches your task, or create a draft you can test before making it live.

Search by name or slug. For example, enter `Triage` to compare the shipped triage workflows.

<Frame caption="The list filtered by Triage shows four shipped examples with their version counts and deployment states.">

![Four filtered triage automations for GitHub, Gmail, IMAP and Outlook, with their versions, deployment states and the Create automation button.](/images/platform/automations-catalog.webp)

</Frame>

## Choose a starting point

Each row shows the automation’s name, project bindings, version count and deployed version, or **Not deployed**. Open it on the **Editor** tab to inspect the workflow. **Versions** holds its saved history; **Runs** shows recent executions. The **Projects** panel controls which boards can use it; without project bindings, it serves the organization.

The **Create automation** menu offers two routes:

| Choice | Use it when | What happens next |
| --- | --- | --- |
| **Blank (trigger + agent)** | You want to configure the workflow yourself. | Set the name, model, instructions and equipment, then choose when it runs. Creation opens the editor for further changes. |
| **Upload package** | You already have a workflow file or a reusable pack. | Tale validates the files and saves a draft version. |

Shipped automations are already installed when the organization is created. They still need configuration and a deployed version before automatic use. Follow [the workflow editor](/platform/automations/editor) to test inputs, inspect results and deploy deliberately.

## Import a package

A pack contains the required `workflow.yml`, an optional `automation.yml` manifest and, optionally, skill bundles:

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

<Steps>

<Step title="Select the files">

Choose **Create automation > Upload package**. Upload the workflow and optional manifest as individual files, or select one `.zip` containing the pack. Use a zip when carrying skills; upload that archive on its own. Markdown notes outside `skills/`, dotfiles and build leftovers such as `node_modules/` and `__pycache__/` are ignored.

</Step>

<Step title="Choose the destination">

Under **Install into**, choose **Organization** or an existing project. A manifest declaring `scope: project` requires a project. Installing an existing automation into another project adds that binding; it does not remove previous ones. You can adjust the full set later in **Projects**.

<Frame caption="Upload package — the files or one zip, and where the automation installs.">

![The upload package dialog with its file drop zone and the Install into picker set to Organization.](/images/platform/automations-upload-dialog.webp)

</Frame>

</Step>

<Step title="Validate and save">

Choose **Upload package** and resolve any reported document, manifest or skill issues. Validation completes before the upload writes the automation and carried skills. A successful upload creates a draft; uploading the same automation again appends a version and preserves its history.

</Step>

<Step title="Review before deployment">

Choose **Later** to inspect and test the draft in the editor. The success dialog also offers deployment of the numbered version. Uploading alone does not change the live version. Configure required credentials and check the supplied skills before deploying.

</Step>

</Steps>

Keep a zip within 20 MiB compressed and 20 MiB expanded, with at most 500 files, 2 MiB per file and 20 skill bundles. If rejected for size, remove generated artifacts and split unrelated material into separate skills rather than increasing compression alone.

## Resolve skill conflicts

The manifest’s `skills` list must match the folders carried under `skills/`: undeclared folders and declared-but-missing bundles are rejected. Each bundle needs valid `SKILL.md` frontmatter with a `name` matching its folder.

```yaml
# automation.yml
name: Review invoices
skills:
  - invoice-rules
```

New bundles are installed into the organization’s [skill library](/platform/workspace/skills), and identical bundles remain unchanged. Different content pauses the upload and lists the affected slugs. Confirm replacement only after reviewing them: the package replaces those shared bundles, and the previous `SKILL.md` remains in each skill’s history. No automation or skill is written before that confirmation.

A workflow may also refer to library skills it does not carry. If one is missing, the upload reports a warning; install an accessible bundle before running the agent that needs it. A saved draft does not prove all its dependencies are ready.

## Configure a project through package forms

A manifest can declare forms that appear when someone selects the automation’s task template. Values belong to the project, so two projects can use the same automation with different policies.

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
              label: Strict checklist
```

A required form appears before the task’s own fields if that project has not been configured. **Save and continue** writes the forms and proceeds to task creation. Later, **Settings** reopens them as tabs; a dot marks unsaved changes, and **Save** writes every changed form. Closing with unsaved edits asks for confirmation.

Saving replaces the form’s flat YAML file, such as `Setup/validation-policy.yaml`. Existing values prefill the form, including values uploaded by hand. Supported field types are `text`, `number`, `boolean` and `select`; stored values are strings. Text fields can specify a `pattern`, and per-entry `i18n` blocks localize titles, labels, help and options. Keep nested structures and lists in separate files the workflow reads.

## Supply reference files through an upload form

An upload form manages files directly instead of producing YAML:

```yaml
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

`subdir` chooses a subfolder of the settings folder. `accept` limits extensions offered by the picker; `match` filters listed names case-insensitively and rejects uploads that would not appear. With `requireFolder: true`, select or create a subfolder before uploading, for example one per reporting period.

Uploads apply immediately and have no **Save** action. They never block task creation. Runs read the folder’s current contents, so finish preparing the reference set before starting work that depends on it.

## Define what the reviewer should receive

The manifest can name deliverables in the task’s **Outcome** area. Declared files stay in the specified order; other attachments and working files remain under **Files**.

```yaml
subjects:
  task:
    outcome:
      files:
        - return.xml
        - report.md
        - name: audit-summary.md
          optional: true
```

A required file appears as **Not ready yet** until a run files it. An optional file appears only once it exists. Patterns support `*` and `?`, such as `return-*.xml`. Without declarations, the outcome shows all files filed by runs, newest first. Use a short explicit list when the reviewer needs to distinguish the final report from supporting work.

## Ask before an approval that decides more

**Approve** closes the task in one click. When approving means more than closing the task, declare that consequence, for example when an integration reports the approval to a client as a filing. **Approve** then asks first and shows your sentence:

```yaml
subjects:
  task:
    review:
      requestChanges: true
      approve:
        confirm: Approving tells the client this return has been filed with the tax authority. Approve only after you have filed it.
        i18n:
          de:
            confirm: Mit der Freigabe erfährt der Kunde, dass diese Abrechnung bei der Steuerverwaltung eingereicht ist. Gib sie erst frei, wenn du sie eingereicht hast.
```

Without `approve`, **Approve** stays a one-click close. Translate the sentence under `i18n`; a locale without its own sentence uses its base language, then the English one.
