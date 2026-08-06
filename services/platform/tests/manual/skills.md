# Skills — Manual Test Plan

> **Purpose**: Exercise the skill library — reusable instruction bundles
> (SKILL.md + optional assets) any chat or agent can read. Covers the settings
> table with its facets, authoring a blank skill, uploading a bundle
> (zip/folder), visibility scopes (org/team; private is retired), the detail
> pane with its bundle tree and asset viewer, edit/delete, and equipping a
> skill on a project agent. Supersedes the smoke rows settings.md F26–F27 with
> depth; the equip surface itself belongs to [projects.md](projects.md).

## Scope & routes

| Surface                        | Route                                          |
| ------------------------------ | ---------------------------------------------- |
| Skill library (table + pane)   | `/dashboard/{org}/settings/skills`             |
| Equip on a project agent (F12) | `/dashboard/{org}/projects/{projectId}/agents` |

The create / upload / detail panes are one dialog (`skills.createDialog.title`
/ `skills.upload.dialogTitle` / the skill's slug as title) on the skills page —
there is no per-skill URL.

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). **Mode A is fully
sufficient** — skills live in the org's config files and never call a
provider. The page is open to **every member** (no role gate on the rail
entry). F7 needs at least one team (Settings → Teams); F12 needs a project
with an agent (see [projects.md](projects.md)). For the upload rows, build a
bundle zip per SETUP.md's extras: any folder with a `SKILL.md` at its root
(frontmatter `name:` + `description:`) zipped up — e.g. zip a copy of a
builtin skill from `configs/platform/custom/skills/`.

> **Agent note**: everything happens inside one dialog (create → detail on
> success); verify persisted writes by closing the pane, reloading
> `/settings/skills`, and reopening the row — never by the toast. For uploads
> through the Playwright MCP, copy the zip into `.playwright-mcp/` first
> (SETUP.md conventions). A fresh mode-A org seeds no skills — the empty state
> (`emptyStates.skills.title`) is correct, not a defect; its click opens the
> create pane directly.

## Automated coverage

No e2e spec exercises skills — `settings-depth.spec.ts` carries only a stale
comment claiming the page is retired (it is live). Unit tests cover pure logic
only (`app/features/skills/lib/skill-filters.test.ts`,
`app/features/skills/utils/skill-load-error.test.ts`); the bundle validation
chain is unit-tested server-side (`convex/skills/bundle_zip.test.ts`). Every
row below is manual against a browser.

| Case(s)               | Status         | e2e spec                                                          |
| --------------------- | -------------- | ----------------------------------------------------------------- |
| B1, B3 (server side)  | 🔶 partial     | — (no e2e; `convex/skills/bundle_zip.test.ts` covers the backend) |
| F1–F12, B2, A1–A2, P1 | ⛔ manual-only | —                                                                 |

Legend: ✅ fully automated · 🔶 partially automated / unit test only ·
⛔ manual-only (no spec).

## Functional tests

| ID  | Test                       | Steps (route + control)                                                                                                                                                                                                                                                                                                                                                              | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Table renders              | `/dashboard/{org}/settings/skills`                                                                                                                                                                                                                                                                                                                                                   | Under the section description (`skills.sectionDescription`) the table renders columns **Name / Description / Visibility / Usage / Labels** (`skills.columns.*`); search (`skills.searchPlaceholder`) narrows by slug, description, **and** label text; a fresh org shows the empty state (`emptyStates.skills.title`) whose click opens the create pane                                                                                                   |
| F2  | Facets                     | Open the table filter → **Visibility** (`skills.library.scopeFilterLabel`) and **Filter by label** (`skills.library.labelFilterLabel`)                                                                                                                                                                                                                                               | The scope facet offers **Organization / Teams / Personal** (`skills.library.tabs.org` / `…tabs.team` / `…tabs.personal`) with OR semantics; the label facet lists the union of all skill labels with **AND** semantics (a row must carry every picked label); clearing restores the full table                                                                                                                                                            |
| F3  | Create a blank skill       | **Add skill** (`skills.addMenu.label`) → **Blank skill** (`skills.createMenu.blank`) → fill **Name** (`skills.createDialog.nameLabel`, slug help `skills.createDialog.nameHelp`), **Description** (`skills.form.description`), **Instructions (body)** (`skills.section.body`) → **Create** (`skills.createDialog.submit`)                                                           | Toast **Skill created** (`skills.createDialog.created`) and the dialog switches to the detail pane titled with the slug; after closing + reload the row is in the table with the description; the name field enforces the slug pattern (`skills.createDialog.namePatternError`)                                                                                                                                                                           |
| F4  | Icon picker                | In the create/detail pane → **Change icon** (`skills.iconPicker.trigger`) → search (`skills.iconPicker.searchPlaceholder`) → pick an icon; later pick **No icon** (`skills.iconPicker.none`)                                                                                                                                                                                         | The popover grid is searchable; a broad query shows the keep-typing footer (`skills.iconPicker.refine`); the picked icon renders on the trigger and, after save + reload, in the table's Name cell; clearing restores the default                                                                                                                                                                                                                         |
| F5  | Upload a zip bundle        | **Add skill** → **Upload zip** (`skills.createMenu.uploadZip`) → drop/pick the bundle zip in the dropzone (`skills.upload.dropOrClick`) → review the preview step → **Upload bundle** (`skills.upload.submit`)                                                                                                                                                                       | The preview lists the parsed **Frontmatter** (`skills.upload.frontmatter`), the **Sharing** block (`skills.upload.sharingHeading` — with no `visibility:` in frontmatter it reads `skills.upload.sharingAs.private`), and **Bundle files** (`skills.upload.bundleFiles`) with the file count (`skills.upload.fileCount`); on submit toast `skills.upload.uploadSuccess`, the dialog switches to the detail pane, and after reload the row is in the table |
| F6  | Upload a folder            | **Add skill** → **Upload folder** (`skills.createMenu.uploadFolder`) → **Choose folder** (`skills.upload.chooseFolder`) → pick a skill folder with `SKILL.md` at its root                                                                                                                                                                                                            | The folder is zipped client-side (`skills.upload.chooseFolderHelp`) and lands on the same preview step as F5; submit behaves identically                                                                                                                                                                                                                                                                                                                  |
| F7  | Visibility scopes          | On a skill you own: **Visibility** (`skills.visibility.label`) → try **Teams** and **Organization** (`skills.visibility.team` / `…org`) → Save; **Private** (`skills.visibility.private`) is retired (#2922) — its help text (`skills.visibility.privateHelp`) says so and steers to a wider sharing; when picking Teams, use **Shared with teams** (`skills.visibility.teamsLabel`) | Teams requires at least one pick (`skills.visibility.teamsRequired`); with zero org teams the Teams radio is disabled with the hint (`skills.visibility.noTeamsHint`); **narrowing** (org→team/private, or dropping a team) opens the destructive confirm (`skills.visibility.narrowingTitle` / `…narrowingWarning`) — widening never warns; after save + reload the table's Visibility badge shows **Organization** / the team name / **Private**        |
| F8  | ~~Usage modes~~ (retired)  | —                                                                                                                                                                                                                                                                                                                                                                                    | Retired in #2922: the "Where it can be used" usage-mode field and its Usage-column badges were removed — a skill is equippable wherever its visibility allows. Do not author against the retired usage keys.                                                                                                                                                                                                                                              |
| F9  | Detail pane & asset viewer | Open a bundle-carrying skill (F5's upload) → the left **Bundle** tree (`skills.detail.tree.heading`, with count `skills.detail.tree.headingCount`) → select an asset file, then `SKILL.md`                                                                                                                                                                                           | A text asset renders in the viewer with **Toggle line wrap** (`skills.viewer.toggleWrap`); an image shows the no-preview notice (`skills.viewer.imageNotice`), other binaries `skills.viewer.binaryNotice`; a skill with only `SKILL.md` shows the tree-empty hint (`skills.detail.tree.empty`); selecting `SKILL.md` swaps back to the metadata + body editor                                                                                            |
| F10 | Edit & persist             | In the detail pane edit the **Description**, **Labels** (`skills.editor.labels`, comma-separated per `skills.editor.labelsHelp`), and body → **Save** (`common.actions.save`)                                                                                                                                                                                                        | Save is disabled until dirty; on save toast **Skill saved** (`skills.editor.saved`); after closing + reload the table shows the new description and label chips, and reopening the pane reads the edited body back                                                                                                                                                                                                                                        |
| F11 | Delete a skill             | Detail pane of a throwaway skill → **Delete skill** (`skills.deleteSkill`) → confirm                                                                                                                                                                                                                                                                                                 | The confirm (`skills.deleteConfirmation`) names the slug and warns equipped chats/agents lose access; on confirm toast `skills.skillDeleted` and after reload the row is gone                                                                                                                                                                                                                                                                             |
| F12 | Equip on a project agent   | `/dashboard/{org}/projects/{projectId}/agents` → open an agent's dialog → under **Equipment** (`projects.agents.equipmentLabel`) open the skills menu (`chat.skills.label`)                                                                                                                                                                                                          | The menu groups **Skills** (`chat.skills.sectionSkills`) and **Connectors** (`chat.skills.sectionConnectors`); org-visible skills are listed (an **Agents only**/**Chat and agents** skill appears, a **Chat only** one does not); with none the empty line reads `chat.skills.emptySkills`; the trigger shows the count (`chat.skills.labelWithCount`) and the selection survives reopening the dialog. Agent depth is [projects.md](projects.md)'s job  |

## Boundary & error tests

| ID  | Test                  | Input                                                                                                                                                    | Expected                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Invalid bundle        | Upload (a) a zip with no `SKILL.md` at the root, (b) a zip whose `SKILL.md` has no frontmatter, (c) a non-zip file renamed `.zip`, (d) two files at once | Each is refused in the dropzone's alert before any upload: (a) `skills.upload.errors.missingSkillMd`, (b) `skills.upload.errors.frontmatterRejected` (detail included), (c) `skills.upload.errors.invalidZip`, (d) `skills.upload.singleFileOnly`; no row appears after reload                                                                                                        |
| B2  | Duplicate name        | (a) **Blank skill** with the name of an existing skill; (b) upload a bundle whose frontmatter `name` matches an existing slug                            | (a) the create dialog blocks inline with `skills.createDialog.exists` — no upsert happens; (b) upload is **not** an error: the destructive replace confirm opens (`skills.upload.replaceTitle` / `…replaceDescription` naming the slug) — confirming toasts `skills.upload.replaceSuccess` and overwrites, cancelling leaves the original intact (verify body unchanged after reload) |
| B3  | Size & structure caps | Upload a zip over 32 MB unpacked; a bundle with a file over 4 MB; a name like `My_Skill` in the create dialog                                            | The oversize zips are refused client-side (`skills.upload.errors.totalTooLarge` / `…errors.assetTooLarge` with the cap in the message); the invalid name shows `skills.createDialog.namePatternError` and Create stays blocked; the same caps are enforced server-side (`convex/skills/bundle_zip.ts`), so a bypassed client still cannot persist a bad bundle                        |

## Accessibility (WCAG 2.1 AA)

| ID  | Check                  | Expected                                                                                                                                                                                                                               |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Pane dialog & controls | The skill dialog traps focus and closes on Escape returning focus to the trigger; the visibility radio group is labelled (`skills.visibility.label`) and arrow-key navigable; the icon-picker grid is keyboard-operable (arrows/Enter) |
| A2  | Upload affordances     | The dropzone is reachable and activatable by keyboard (`skills.upload.dropZoneLabel`); validation failures render in a `role="alert"` region announced to assistive tech, not color alone                                              |

## Performance

| ID  | Metric       | Target                                                                                       |
| --- | ------------ | -------------------------------------------------------------------------------------------- |
| P1  | Library load | The table (content or empty state) renders in < 3 s on the mock stack — no unbounded spinner |

## Issues Found

| #   | Test ID | Route / URL | Severity (crit/high/med/low) | Description | Screenshot |
| --- | ------- | ----------- | ---------------------------- | ----------- | ---------- |
|     |         |             |                              |             |            |

## Test summary

```
Area: Skills
Functional: ___/12   Boundary: ___/3   A11y: ___/2   Perf: ___/1
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
