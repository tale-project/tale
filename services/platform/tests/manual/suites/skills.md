# Skills

> **Prefix** `SKILL-` · **Reset** none · **Cost** 34 boxes

Exercise the skill library — reusable instruction bundles (SKILL.md + optional
assets) that project agents and automation agent nodes are equipped with; chat
does not use them. Covers the settings table with its facets,
authoring a blank skill, uploading a bundle (zip/folder), visibility scopes
(org/team; private is retired), the detail pane with its bundle tree and asset
viewer, edit/delete, and equipping a skill on a project agent. Supersedes the
smoke rows settings.md F26–F27 with depth; the equip surface itself belongs to
[projects.md](projects.md).

## Scope & routes

| Surface                        | Route                                          |
| ------------------------------ | ---------------------------------------------- |
| Skill library (table + pane)   | `/dashboard/{org}/settings/skills`             |
| Equip on a project agent (SKILL-F12) | `/dashboard/{org}/projects/{projectId}/agents` |

The create / upload / detail panes are one dialog (`skills.createDialog.title`
/ `skills.upload.dialogTitle` / the skill's slug as title) on the skills page
— there is no per-skill URL.

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). **Mode A is fully
sufficient** — skills live in the org's config files and never call a
provider. The page is open to **every member** (no role gate on the rail
entry). SKILL-F7 needs at least one team (Settings → Teams); SKILL-F12 needs a
project with an agent (see [projects.md](projects.md)). For the upload rows,
build a bundle zip per SETUP.md's extras: any folder with a `SKILL.md` at its
root (frontmatter `name:` + `description:`) zipped up — e.g. zip a copy of a
builtin skill from `configs/platform/custom/skills/`.

> **Agent note**: everything happens inside one dialog (create → detail on
> success); verify persisted writes by closing the pane, reloading
> `/settings/skills`, and reopening the row — never by the toast. For uploads
> through the Playwright MCP, copy the zip into `.playwright-mcp/` first
> (SETUP.md conventions). A fresh mode-A org seeds no skills — the empty state
> (`emptyStates.skills.title`) is correct, not a defect; **Add skill > Blank
> skill** (`skills.addMenu.label` / `skills.createMenu.blank`) opens the create
> pane.

## Functional tests

- [ ] `SKILL-F1` · **Table renders** — `/dashboard/{org}/settings/skills` →
  Under the section description (`skills.sectionDescription`) the table
  renders columns **Name / Description / Created by / Visibility / Labels**
  (`skills.columns.*`); search (`skills.searchPlaceholder`) narrows by slug,
  description, **and** label text; a fresh org shows the empty state
  (`emptyStates.skills.title`) whose description
  (`emptyStates.skills.description`) points at project agents and automation
  agent nodes — never at chat, which does not use skills. **Add skill > Blank
  skill** (`skills.addMenu.label` / `skills.createMenu.blank`) opens the create
  pane by pointer or keyboard.
  description, label text **and** creator name; a fresh org shows the empty state
  (`emptyStates.skills.title`) whose click opens the create pane.
- [ ] `SKILL-F2` · **Facets** — Open the table filter → **Visibility**
  (`skills.library.scopeFilterLabel`) and **Filter by label**
  (`skills.library.labelFilterLabel`) → The scope facet offers **Organization
  / Teams / Personal** (`skills.library.tabs.org` / `…tabs.team` /
  `…tabs.personal`) with OR semantics; the label facet lists the union of all
  skill labels with **AND** semantics (a row must carry every picked label);
  clearing restores the full table.
- [ ] `SKILL-F3` · **Create a blank skill** — **Add skill**
  (`skills.addMenu.label`) → **Blank skill** (`skills.createMenu.blank`) →
  fill **Name** (`skills.createDialog.nameLabel`, slug help
  `skills.createDialog.nameHelp`), **Description**
  (`skills.form.description`), **Instructions (body)** (`skills.section.body`)
  → **Create** (`skills.createDialog.submit`) → Toast **Skill created**
  (`skills.createDialog.created`) and the dialog switches to the detail pane
  titled with the slug; after closing + reload the row is in the table with
  the description; the name field enforces the slug pattern
  (`skills.createDialog.namePatternError`)
- [ ] `SKILL-F4` · **Icon picker** — In the create/detail pane → **Change
  icon** (`skills.iconPicker.trigger`) → search
  (`skills.iconPicker.searchPlaceholder`) → pick an icon; later pick **No
  icon** (`skills.iconPicker.none`) → The popover grid is searchable; a broad
  query shows the keep-typing footer (`skills.iconPicker.refine`); the picked
  icon renders on the trigger and, after save + reload, in the table's Name
  cell; after **No icon** + save + reload the trigger and the Name cell show
  the default again and the picker has nothing checked.
- [ ] `SKILL-F5` · **Upload a zip bundle** — **Add skill** → **Upload zip**
  (`skills.createMenu.uploadZip`) → drop/pick the bundle zip in the dropzone
  (`skills.upload.dropOrClick`) → review the preview step → **Upload bundle**
  (`skills.upload.submit`) → The preview lists the parsed **Frontmatter**
  (`skills.upload.frontmatter`), the **Sharing** block
  (`skills.upload.sharingHeading` — with no `visibility:` in frontmatter it
  reads `skills.upload.sharingAs.private`), and **Bundle files**
  (`skills.upload.bundleFiles`) with the file count
  (`skills.upload.fileCount`); on submit toast `skills.upload.uploadSuccess`,
  the dialog switches to the detail pane, and after reload the row is in the
  table.
- [ ] `SKILL-F6` · **Upload a folder** — **Add skill** → **Upload folder**
  (`skills.createMenu.uploadFolder`) → **Choose folder**
  (`skills.upload.chooseFolder`) → pick a skill folder with `SKILL.md` at its
  root → The folder is zipped client-side and read — **Reading bundle…**
  (`skills.upload.parsing`) — and lands on the same preview step as SKILL-F5;
  submit behaves identically.
- [ ] `SKILL-F7` · **Visibility scopes** — On a skill you own: **Visibility**
  (`skills.visibility.label`) → try **Teams** and **Organization**
  (`skills.visibility.team` / `…org`) → Save; **Private**
  (`skills.visibility.private`) is retired (#2922) — its help text
  (`skills.visibility.privateHelp`) says so and steers to a wider sharing;
  when picking Teams, use **Shared with teams**
  (`skills.visibility.teamsLabel`) → Teams requires at least one pick
  (`skills.visibility.teamsRequired`); with zero org teams the Teams radio is
  disabled with the hint (`skills.visibility.noTeamsHint`); **narrowing**
  (org→team/private, or dropping a team) opens the destructive confirm
  (`skills.visibility.narrowingTitle` / `…narrowingWarning`) — widening never
  warns; after save + reload the table's Visibility badge shows
  **Organization** / the team name / **Private**.
- [ ] `SKILL-F8` · **~~Usage modes~~ (retired)** → Retired in #2922: the
  "Where it can be used" usage-mode field and its Usage-column badges were
  removed — a skill is equippable wherever its visibility allows. Do not
  author against the retired usage keys.
- [ ] `SKILL-F9` · **Detail pane & asset viewer** — Open a bundle-carrying
  skill (SKILL-F5's upload) → the left **Bundle** tree
  (`skills.detail.tree.heading`, with count `skills.detail.tree.headingCount`)
  → select an asset file, then `SKILL.md` → A text asset renders in the viewer
  with **Toggle line wrap** (`skills.viewer.toggleWrap`); an image shows the
  no-preview notice (`skills.viewer.imageNotice`), other binaries
  `skills.viewer.binaryNotice`; a skill with only `SKILL.md` shows the
  tree-empty hint (`skills.detail.tree.empty`); selecting `SKILL.md` swaps
  back to the metadata + body editor.
- [ ] `SKILL-F14` · **Asset viewer look** — In light and then in dark, open
  a bundle's `.ts`, `.json`, `.md` and `.txt` assets, the first code asset
  right after a reload → Characters line up in columns in the code and
  `.txt` assets; keywords, strings and numbers of the `.ts` and `.json`
  assets take distinct colours on the theme's code surface; every line
  number can be read out at 100 % zoom; the `.md` asset renders as formatted
  markdown (headings, lists, emphasis), not as numbered source; while the
  first code asset loads, no row moves when the colours arrive.
- [ ] `SKILL-F10` · **Edit & persist** — In the detail pane edit the
  **Description**, **Labels** (`skills.editor.labels`, comma-separated per
  `skills.editor.labelsHelp`), and body → **Save** (`common.actions.save`) →
  Save is disabled until dirty; on save toast **Skill saved**
  (`skills.editor.saved`); after closing + reload the table shows the new
  description and label chips, and reopening the pane reads the edited body
  back.
- [ ] `SKILL-F11` · **Delete a skill** — Detail pane of a throwaway skill →
  **Delete skill** (`skills.deleteSkill`) → confirm → The confirm
  (`skills.deleteConfirmation`) names the slug and warns that every equipped
  agent is unequipped; on confirm toast `skills.skillDeleted` and after reload
  the row is gone.
- [ ] `SKILL-F12` · **Equip on a project agent** —
  `/dashboard/{org}/projects/{projectId}/agents` → open an agent's dialog →
  under **Equipment** (`projects.agents.equipmentLabel`) open the skills menu
  (`chat.skills.label`) → The menu groups **Skills**
  (`chat.skills.sectionSkills`) and **Connectors**
  (`chat.skills.sectionConnectors`); the org-visible skills and the
  team-visible skills shared with one of the project's teams are listed; with
  none the empty line reads `chat.skills.emptySkills`; the trigger
  shows the count (`chat.skills.labelWithCount`) and the selection survives
  reopening the dialog. Agent depth is [projects.md](projects.md)'s job.
- [ ] `SKILL-F13` · **Deleting an equipped skill unequips it** — Create a
  skill, equip it on a project agent (the row reads **1 equipped**), then
  Settings → Skills → open it → **Delete skill** → confirm
  (`skills.deleteConfirmation`) → The agent's row no longer counts it, its
  dialog opens with **Skills (0)** and saves any other change (model,
  instructions) without a refusal, a run started from it starts normally,
  and Governance → Logs carries a **Skill deleted** row
  (`settings.logs.audit.actionLabels.skill.deleted`) naming the agent. A
  skill that is merely unshared from the project's scope instead shows in
  the dialog's skills menu as **"<slug>" (unavailable)**
  (`chat.skills.unavailableOption`), checked, so it can be unticked.
- [ ] `SKILL-F15` · **Agent picks a skill by its description** — Create a
  skill `invoice-check` whose description reads "Use when a task asks to
  check an invoice" and whose body asks for totals, VAT and due date under
  the heading "Invoice skill review". Equip it together with `docx` on a
  project agent, then create a task "Is the attached invoice correct?" with
  a synthetic invoice attached and **no skill named** → The turn reads
  `invoice-check/SKILL.md` and the report uses its unique heading and checks.
  Repeat on a fresh task with `disable-model-invocation: true` in the skill
  file: it is not used unless the task names it. Then name the skill in
  another task and verify that its instructions are followed again.
- [ ] `SKILL-F16` · **Created by** — As member A create a blank skill; keep a
  seeded builtin (`docx`) in view; remove a member B who created a skill from
  the organization (Settings → Members) → The table's **Created by** column
  (`skills.columns.createdBy`) reads A's name on A's skill, **Built-in**
  (`skills.attribution.builtin`) on `docx`, **Former member**
  (`skills.attribution.formerMember`) on B's skill — never a raw user id —
  and a skill a managed configuration release installed reads
  **Configuration release · <installing member>**
  (`skills.attribution.releaseBy`); a zip A uploads whose `SKILL.md`
  frontmatter carries the release marker (`tale-release` under `metadata`)
  reads **Configuration release · <A's name>**,
  never the bare label; searching A's name keeps only A's skills; the skill
  dialog's **Created by** row (`skills.attribution.createdBy`) says the
  same; every cell of the row still fits the page at 1280 px in English,
  German and French.
- [ ] `SKILL-F17` · **Last edited by** — Open the skill A just created; then,
  as an admin C, change its description and save; then edit its `SKILL.md`
  on disk (`$TALE_CONFIG_DIR/<org>/skills/<slug>/SKILL.md`) and reload → A
  skill nobody has edited since creating it shows no **Last edited by** row
  (`skills.attribution.lastEditedBy`); after C's save the row names C, in
  the dialog and on `GET /api/v1/skills/<slug>` (`updatedByName`); after
  the out-of-band edit the row is gone again while **Created by** still
  names A.
- [ ] `SKILL-F18` · **Creator in the agent skill picker** —
  `/dashboard/{org}/projects/{projectId}/agents` → open an agent's dialog →
  open the skills menu (`chat.skills.label`), then an automation agent node's
  skills menu → Under every skill row a caption names its creator: **By
  <name>** (`skills.attribution.byMember`), **By a former member**
  (`skills.attribution.byFormerMember`), **Built-in** or **Configuration
  release · <installing member>**; connector and tool rows carry no such caption; the caption is
  part of the row's accessible name and toggling a row still works by
  keyboard.
- [ ] `SKILL-F19` · **Skill writes in the audit log** — As an admin: create a
  skill, edit its body, switch it from Organization to a team, save it again
  unchanged, replace it by a zip upload that keeps its sharing, then install
  an automation package that carries a new skill → Settings → Governance →
  Logs, category **Skill**, lists in order **Skill created**, **Skill
  updated**, **Skill updated** + **Skill sharing changed**, (nothing for the
  unchanged save), **Skill updated**, **Skill created**
  (`settings.logs.audit.actionLabels.skill.created` / `…skill.updated` /
  `…skill.sharing_changed`), each naming the acting member; a row's details
  show its changed fields, the sharing row the visibility and teams before
  and after, and the metadata the door (`app`, `upload`,
  `automation_package`) and the resulting `etag`.
- [ ] `SKILL-F20` · **Create asks for the audience** — In an organization
  without a skill sharing policy, **Add skill** → **Blank skill** → The
  create dialog shows **Visibility** (`skills.visibility.label`) under the
  description with **Organization** (`skills.visibility.org`) preselected;
  picking **Teams** (`skills.visibility.team`) keeps **Create** off until a
  team is picked; a skill created with a team reads that team's badge in the
  table after reload, and one created with Organization reads
  **Organization**.
- [ ] `SKILL-F21` · **Remembered folders** — Open a skill whose bundle nests
  folders (SKILL-F5's upload), collapse a top-level folder and a folder
  inside another open one in the **Bundle** tree
  (`skills.detail.tree.heading`), close the dialog and reopen the skill, then
  reload the page and reopen it once more; upload the bundle again with an
  extra top-level folder; then open a skill whose folders you have not
  collapsed in this browser → Both folders are still collapsed after each
  reopen and every other folder is open; the folder the new upload added
  opens expanded while the two stay collapsed; the other skill's tree opens
  with every folder expanded.

## Boundary & error tests

- [ ] `SKILL-B1` · **Invalid bundle** — Upload (a) a zip with no `SKILL.md` at
  the root, (b) a zip whose `SKILL.md` has no frontmatter, (c) a non-zip file
  renamed `.zip`, (d) two files at once → Each is refused in the dropzone's
  alert before any upload: (a) `skills.upload.errors.missingSkillMd`, (b)
  `skills.upload.errors.frontmatterRejected` (detail included), (c)
  `skills.upload.errors.invalidZip`, (d) `skills.upload.singleFileOnly`; no
  row appears after reload.
- [ ] `SKILL-B2` · **Duplicate name** — (a) **Blank skill** with the name of
  an existing skill; (b) upload a bundle whose frontmatter `name` matches an
  existing slug → (a) the create dialog blocks inline with
  `skills.createDialog.exists` — no upsert happens; (b) upload is **not** an
  error: the destructive replace confirm opens (`skills.upload.replaceTitle` /
  `…replaceDescription` naming the slug) — confirming toasts
  `skills.upload.replaceSuccess` and overwrites, cancelling leaves the
  original intact (verify body unchanged after reload)
- [ ] `SKILL-B3` · **Size & structure caps** — Upload a zip over 32 MB
  unpacked; a bundle with a file over 4 MB; a name like `My_Skill` in the
  create dialog → The oversize zips are refused client-side
  (`skills.upload.errors.totalTooLarge` / `…errors.assetTooLarge` with the cap
  in the message); the invalid name shows
  `skills.createDialog.namePatternError` and Create stays blocked; the same
  caps are enforced server-side (`convex/skills/bundle_zip.ts`), so a bypassed
  client still cannot persist a bad bundle.
- [ ] `SKILL-B4` · **Uploads cannot borrow a name or a team** — As a Member in
  team T1 only, upload a zip whose `SKILL.md` says `owner: <another member's
  id>` → the new skill lists you as its owner. Upload one that says
  `visibility: team` with the id of a team T2 you are not in (or an id that
  does not exist) → the upload is refused because you cannot share with that
  team, and no skill is written. As a Developer, upload an automation package
  carrying the same two skills → the same outcomes; re-uploading an unchanged
  package reports its skills as unchanged, with no overwrite prompt.
- [ ] `SKILL-B5` · **A reserved organization-wide audience** — As an admin,
  set Settings → Governance → Policies & Limits → **Skill sharing**
  (`governance.skillSharing.title`) to **Owners and admins only**
  (`governance.skillSharing.modes.admins`) while a Member in team T1 owns an
  organization-wide skill; then, as that Member: open **Blank skill**; open
  the owned skill and edit its body; switch it to **Teams** → T1 and save;
  delete it; upload a zip without `visibility:` → The create dialog preselects
  **Teams**, its **Organization** option is disabled with the reason
  (`skills.publishing.reserved.admins`), and a T1 skill creates; the owned
  skill still reads **Organization** (tightening narrowed nothing), its
  dialog shows the notice (`skills.publishing.lockedEdit`) and **Save** stays
  off until it is narrowed, after which it saves; delete works; the upload
  preview shows the reason with `skills.publishing.uploadRefused` and
  **Upload bundle** stays off. `PUT /api/v1/skills/{slug}` with the Member's
  key and no `visibility` answers 403 `SKILL_PUBLISH_FORBIDDEN`, and
  Governance → Logs lists **Skill publishing refused**
  (`settings.logs.audit.actionLabels.skill.publish_denied`) as denied.
  Restore **Every member** afterwards.
- [ ] `SKILL-B6` · **Who may publish anyway** — With **Editors and above**
  (`governance.skillSharing.modes.editors`) set: an Editor creates an
  organization-wide skill; a Member cannot (the reason reads
  `skills.publishing.reserved.editors`) until an admin grants them **Publish
  skills to the organization**
  (`governance.competences.capabilities.skillsPublish.label`) under
  Governance → Competences, after which a reload offers **Organization** and
  the create succeeds; `GET /api/v1/me` reports `skillPublish` among its
  capabilities as `false`, then `true`; revoking the grant refuses the next organization-wide
  save again. Under **Owners and admins only**, a Developer's automation
  package carrying a skill without `visibility:` is refused with 403
  `SKILL_PUBLISH_FORBIDDEN` and installs nothing. Restore **Every member**.
- [ ] `SKILL-B7` · **A failed read is not a missing skill** — Reload the page
  (the dialog keeps what it read for a while), block the request
  `/api/app/skills/<slug>` in the browser's developer tools, open the row and
  wait for the loading mask to end; lift the block and press **Try again**
  (`common.actions.tryAgain`); block the skill's `/assets/<path>` request and
  pick that file, one you have not opened since the reload; lift it and press
  **Try again**; then pick an empty file, and a file you deleted on disk before
  first picking it → The dialog reads `skills.detail.loadFailed`, never
  `skills.notFound`, and its retry shows the saved instructions without
  reopening; the file pane reads `skills.viewer.loadFailed` with **Copy**
  (`common.actions.copy`) off, never an empty preview, and its retry shows the
  contents; the empty file reads `skills.viewer.empty`; the deleted one reads
  `skills.viewer.notFound`; nothing on disk changed.
- [ ] `SKILL-B8` · **Labels over the cap** — In the detail pane enter nine
  comma-separated labels in **Labels** (`skills.editor.labels`), remove one of
  your choice and **Save** (`common.actions.save`); then enter a label of 41
  characters → With nine, the field shows `skills.editor.labelsTooMany`,
  still holds all nine and **Save** stays off; with eight, the save stores
  exactly the eight you kept (close, reload, reopen and read them back); the
  long label shows `skills.editor.labelTooLong` and **Save** stays off.

## Accessibility (WCAG 2.1 AA)

- [ ] `SKILL-A1` · **Pane dialog & controls** → The skill dialog traps focus
  and closes on Escape returning focus to the trigger; the visibility radio
  group is labelled (`skills.visibility.label`) and arrow-key navigable; the
  icon-picker grid is keyboard-operable (arrows/Enter)
- [ ] `SKILL-A2` · **Upload affordances** → The dropzone is reachable and
  activatable by keyboard (`skills.upload.dropZoneLabel`); validation failures
  render in a `role="alert"` region announced to assistive tech, not color
  alone.
- [ ] `SKILL-A3` · **Icon picker by keyboard** — **Change icon**
  (`skills.iconPicker.trigger`), then with focus in **Search icons**
  (`skills.iconPicker.searchPlaceholder`) press Tab; press ArrowDown ten
  times and Enter; reopen and click an icon; reopen, move with the arrows and
  press Escape → Tab never walks the icons; the highlighted icon stays in
  view as it moves down the grid; Enter picks it and focus returns to
  **Change icon**; the click picks exactly the clicked icon; Escape closes the
  picker without a change and returns focus to **Change icon**.
- [ ] `SKILL-A4` · **Bundle tree keeps its Tab stop** — Tab into the
  **Bundle** tree, ArrowDown to a file inside a folder and press Enter;
  ArrowLeft to its folder and ArrowLeft again to collapse it; Tab away, then
  Shift+Tab; press ArrowRight and reach another file with the arrows and
  Enter; close the dialog and open the skill again → Shift+Tab lands on the
  collapsed folder, not past the tree; ArrowRight opens it and the arrows and
  Enter select the other file; the reopened dialog's tree takes Tab on
  `SKILL.md`.

## Performance

- [ ] `SKILL-P1` · **Library load** → The table (content or empty state)
  renders in < 3 s on the mock stack — no unbounded spinner.
