# Knowledge

> **Prefix** `KNOW-` · **Reset** none · **Cost** 32 boxes

Exercise the knowledge surfaces — documents (upload + RAG indexing + preview +
controlled revisions), manual knowledge entries, and the structured catalogs
(products, contacts, websites). These feed the chat agent's reads and RAG.

## Scope & routes

| Surface           | Route                                |
| ----------------- | ------------------------------------ |
| Documents         | `/dashboard/{org}/documents`         |
| Knowledge entries | `/dashboard/{org}/knowledge-entries` |
| Products          | `/dashboard/{org}/products`          |
| Contacts          | `/dashboard/{org}/contacts`          |
| Websites          | `/dashboard/{org}/websites`          |

(All five live under the pathless `_knowledge` layout segment — it does not
appear in the URL. The customers+vendors merge (#2618) retired `/customers`
and `/vendors` in favor of `/contacts`; both now carry a legacy redirect to
`/contacts` — matching the workflows-area precedent of keeping a redirect for
a renamed route rather than leaving a dead link. Don't author new steps
against `/customers` or `/vendors`.)

## Preconditions

Bring the stack up and sign in per [SETUP.md](../setup.md). Have a small
PDF/DOCX/ODT/TXT to hand for the upload + preview tests, plus a changed file
with the same extension for the controlled-revision test. Create throwaway
records and delete them after.

> **Agent note**: These are DataTable list pages. The header create affordance
> is a split/menu button (e.g. **Upload documents**, **Add product**) that
> opens a menu — pick **From your device** / **Manual entry** inside it; it is
> not a direct dialog. Each row's **Open menu** (`common.actions.openMenu`)
> 3-dot button starts with **View** (`common.actions.view`) for every member;
> edit/delete follow for writers — contacts expose them only on manually-created
> rows. A row click opens the same details dialog. Verify every write by reloading the route and reading the row back,
> never by the toast. Document **indexing** needs the RAG service, which is
> NOT in the hermetic mock stack, so an uploaded doc lands **Queued** then
> flips to **Failed** (terminal here) — both are valid hermetic landing
> states.

## Functional tests

- [ ] `KNOW-F1` · **Upload document** — Documents → header **Upload
  documents** menu (`documents.upload.importDocuments`) → **From your device**
  (`documents.upload.fromYourDevice`) → in the **Upload documents** dialog
  (title = `documents.upload.importDocuments`) attach a small PDF/TXT via the
  drop zone → **Upload** (`documents.upload.uploadDocuments`) → A row carrying
  the filename appears with a RAG-status badge **Queued**
  (`documents.rag.status.queued`); on the hermetic stack it then flips to
  **Failed** (`documents.rag.status.failed`) once indexing runs with no RAG
  backend. Reload `/documents`: the row is still present.
- [ ] `KNOW-F2` · **Documents organize** — Documents → **Upload documents**
  menu → **New folder** (`documents.folder.newFolder`) → in the **Create
  folder** dialog (title `documents.folder.createFolder`) fill **Folder name**
  (`documents.folder.folderName`) → **Create folder**
  (`documents.folder.createFolder`); move a doc into it; filter with the page
  search **Search documents** (`documents.searchPlaceholder` — the similar
  `documents.searchFilesAndFolders` is the Microsoft 365 picker's search, not
  this page's); then delete the folder via its row **Open menu** → **Delete
  folder** (dialog title `documents.deleteFolder.title`). (Microsoft 365
  **From Microsoft 365** (`documents.upload.fromMicrosoft365`) is always in
  the menu; Connect Microsoft 365 runs Knowledge cloud-import OAuth, not SSO.)
  → The created folder appears and survives a reload of `/documents`. The
  moved document is listed inside the folder and is GONE from the root — the
  root lists only documents that sit in no folder, never a folder's files
  beside the folder row. Submitting the dialog with an empty name shows
  **Folder name is required**
  (`documents.folder.nameRequired`) and the dialog stays open. Search narrows
  the list to matching names. The **Delete folder** dialog shows the cascade
  requirement **"All files and subfolders inside this folder will also be
  permanently deleted."** (`documents.deleteFolder.requirement`); after
  confirm + reload the folder row is gone. **From Microsoft 365** remains
  available before an account is connected; its first-use flow shows the
  required setup or connection step.
- [ ] `KNOW-F3` · **Knowledge entry CRUD** — Knowledge entries → **Add entry**
  (`knowledgeEntries.addButton`) → **Topic** (`knowledgeEntries.topic`) +
  **Content** (`knowledgeEntries.content`) → **Save** (`common.actions.save`);
  then row **Open menu** → **Edit** (dialog title
  `knowledgeEntries.editEntry`) → change topic → Save; then row menu →
  **Delete** (dialog title `knowledgeEntries.delete.title`) → confirm → After
  create, the topic appears in the list AND survives a reload of
  `/knowledge-entries` (verified live: persisted). Edit toast =
  `knowledgeEntries.toast.updateSuccess` ("Knowledge entry updated"); the
  renamed topic survives reload. After delete + reload the row is gone.
- [ ] `KNOW-F4` · **Product CRUD** — Products → header **Add product** menu
  (`products.addButton`) → **Manual entry**
  (`products.importMenu.manualEntry`) → **Product name**
  (`products.edit.labels.name`) → submit (create dialog title
  `products.create.title`); then row **Open menu** → **Edit** (dialog title
  `products.edit.title`) → rename → Save; then row menu → **Delete** (dialog
  title `products.delete.title`) → confirm → Create toast =
  `products.create.toast.success` ("Product created successfully"); edit toast
  = `products.edit.toast.success` ("Product updated successfully"). Each
  change survives a reload of `/products`. After delete + reload the row is
  gone (delete toast `toast.success.deleted.title`).
- [ ] `KNOW-F5` · **Contact CRUD** — Contacts → header **Add** menu
  (`contacts.addButton`) → **From your device**
  (`contacts.importMenu.fromDevice`) → in the **Upload contacts** dialog
  (title `contacts.import.uploadContacts`) provide one `email,name` line (see
  the in-dialog format hint) → **Import** (`contacts.import.import`); then row
  **Open menu** → **Edit** (dialog title `contacts.editContact`) → rename
  **Name** (`contacts.name`) → Save; row menu → **Delete** (dialog title
  `contacts.deleteContact`) → confirm; search via **Search contacts**
  (`contacts.searchPlaceholder`) — the **Manual entry** item
  (`contacts.importMenu.manualEntry`) opens the single-contact create dialog
  instead → Import toast `contacts.import.success`; the row survives reload of
  `/contacts`. Edit toast = `contacts.updateSuccess` ("Contact updated
  successfully"); the renamed row survives reload. Search narrows the list to
  the matching name. After delete + reload the row is gone. (Customers+vendors
  were merged into one `contacts` entity in #2618; the spec that automated
  this path was retired in #2857.)
- [ ] `KNOW-F6` · **Website add** — Websites → **Add website**
  (`websites.addButton`) → in the **Add website** dialog (title
  `websites.addWebsite`) fill **Domain** (`websites.domain`, placeholder
  `websites.urlPlaceholder` = "example.com") with `example.com`, pick a **Scan
  interval** (`websites.scanInterval`) → submit → Success toast =
  `websites.toast.addSuccess` ("Website added successfully"). The domain row
  appears AND survives a reload of `/websites` (verified live: persisted).
  Crawl runs only with the crawler service — out of the hermetic stack — so a
  scan status need not progress here.
- [ ] `KNOW-F7` · **Document preview** — Documents → click a previewable row
  (PDF/DOCX/XLSX/image/text) → Preview renders inline by file type; **Download
  file** (`documents.preview.downloadFile`) triggers a download; **Close
  preview** (`documents.preview.closePreview`) closes the dialog and returns
  focus to the row. An unpreviewable type shows **Preview not available**
  (`documents.preview.notAvailable`).
- [ ] `KNOW-F8` · **Upload ODT** — Documents → **Upload documents**
  (`documents.upload.importDocuments`) → **From your device**
  (`documents.upload.fromYourDevice`) → attach a small **`.odt`** file →
  **Upload** (`documents.upload.uploadDocuments`) → `.odt` is **accepted** (it
  was previously rejected as unsupported): a row with the filename appears and
  reaches a RAG badge **Queued** (`documents.rag.status.queued`) → **Failed**
  (`documents.rag.status.failed`) on the hermetic stack (no RAG backend). The
  upload dialog's drop-zone hint reads **"PDF, DOCX, ODT, XLSX, CSV, TXT up to
  {maxSize} MB"** (`documents.upload.dropZoneDescription`). ODT text
  extraction (headings/lists/tables) is unit-tested in
  `extraction/odt.test.ts`; full RAG indexing needs the RAG service (out of
  the hermetic stack).
- [ ] `KNOW-F9` · **Large file (100 MB cap)** — Mode A (RAG backend up).
  Generate a ~99 MB text file WITHOUT holding it in RAM: `node -e "const
  w=require(&quot;fs&quot;).createWriteStream(&quot;/tmp/big.txt&quot;);let
  i=0;(function loop(){let
  ok=true;while(ok&&i<99*1024){ok=w.write((&quot;chunk &quot;+i+&quot;
  &quot;).repeat(128).slice(0,1024));i++}if(i<99*1024)w.once(&quot;drain&quot;,loop);else
  w.end()})()"` → Documents → **Upload documents** → attach `/tmp/big.txt` →
  **Upload**; when done, delete `/tmp/big.txt` → The upload progresses (no
  dialog wedge), the row reaches a RAG badge past **Queued** and eventually
  **Indexed** (`documents.rag.status.indexed`) — allow several minutes for
  embedding; chat retrieval then cites the file. The dialog hint shows the cap
  (`documents.upload.dropZoneDescription`, {maxSize} = 100). With per-org
  object storage configured, the object appears in the org bucket (see
  [data-residency.md](data-residency.md) DATA-F4)
- [ ] `KNOW-F10` · **Website source types** — Websites → **Add website**
  (`websites.addButton`) → in the dialog switch **Source type**
  (`websites.addMode.label`) between **Single website**
  (`websites.addMode.site`) and **URL list** (`websites.addMode.list`); in
  list mode paste 2–3 URLs into the **URL list** textarea (`websites.urlList`,
  placeholder `websites.urlListPlaceholder`, hint `websites.urlListHint`) →
  submit → Site mode shows the **Domain** field (KNOW-F6); list mode replaces
  it with the URL-list textarea. Submitting the list adds one row per valid
  URL — success toast `websites.toast.addListSuccess` (or
  `websites.toast.addListPartial` when some URLs were rejected); the rows
  survive a reload of `/websites`
- [ ] `KNOW-F11` · **Failed indexing → embedding CTA** — Mode A (no embedding
  model configured): upload a doc (KNOW-F1), wait for the **Failed** badge
  (`documents.rag.status.failed`) → click the badge to open the RAG status
  dialog → The dialog explains the failure with the hint **…no embedding model
  is configured…** (`documents.rag.dialog.failed.embeddingNotConfigured.hint`)
  and — for an admin — a **Configure embedding model** LinkButton
  (`documents.rag.dialog.failed.embeddingNotConfigured.configureCta`) that
  navigates to `/dashboard/{org}/settings/data-residency`; a non-admin instead
  sees the ask-your-admin line
  (`documents.rag.dialog.failed.embeddingNotConfigured.askAdmin`)
- [ ] `KNOW-F12` · **Replace controlled-document file** — Documents → use an
  approved controlled document, or open a regular document's row **Open menu**
  and choose **Mark as controlled**
  (`documents.record.actions.markControlled`) → row menu → **Replace file**
  (`documents.record.actions.replaceFile`) without clicking **New revision** →
  choose a changed file with the same extension → confirm **Replace file** for
  a draft or **Replace and open draft v{version}**
  (`documents.record.replace.approvedConfirm`) for an approved record → open
  the document preview → reload `/documents`. The same record row menu (badge
  + Mark as controlled/Submit/Review/Replace/New revision) is on a project's
  **Knowledge** tab file rows for project editors — repeat the mark → submit →
  approve leg there once → The dialog closes and the existing row remains a
  single document with the same name. A draft replacement keeps its version;
  an approved v1 replacement atomically opens `v2 · Draft` only after success.
  Preview shows the replacement content after reload. The approved v1 snapshot
  is unchanged, no same-named second row appears, and cancellation leaves v1
  approved. RAG returns to **Queued**/**Indexing** and then reaches the
  environment's normal terminal state. **Submit for review** freezes the
  replacement as the file reviewers inspect.
- [ ] `KNOW-F13` · **Page failure reason** — Websites → **Add website** →
  **URL list** (KNOW-F10) with two URLs on one public site: a healthy page
  and one that answers a redirect into a private address (`http://127.0.0.1/`
  behind a `302`) or a plain `500` → wait for the scan → row **Open menu** →
  **View** (`common.actions.view`) → the **Website pages** section
  (`websites.pagesDialog.title`) → The healthy page shows its word and chunk
  counts; the
  failed page shows no words and no chunks but a destructive caption naming
  the failed attempts and the reason (`websites.pagesDialog.lastError` — a
  refused plaintext/private redirect reads as exactly that, never as a page
  nobody fetched), and the pages header counts it
  (`websites.pagesDialog.failedPages`). Reload `/dashboard/{org}/websites`
  and reopen → the reason is still there (stored on the page, not remembered
  by the tab). Fix the origin, or re-save the same list → the next scan
  turns the page indexed and the caption is gone.
- [ ] `KNOW-F14` · **Skipped-page reasons** — Websites → **Add website** →
  **URL list** (KNOW-F10) with three URLs on a host you control: a healthy
  page, a JSON endpoint (`/data.json`), and a page served with
  `X-Robots-Tag: noindex` → wait for the scan → row **Open menu** → **View**
  → the **Website pages** section → The healthy page shows its counts; the JSON
  row and the noindex
  row show no words and no chunks but a caption naming the reason
  (`websites.pagesDialog.lastError` — "unsupported content" for the JSON,
  "asked not to be indexed" for the noindex page), never a blank row that
  looks unfetched; the site's **Status** reads **Active** because one page
  stored. Re-list the same three URLs → the two reasons persist and their
  attempt counts grow. Then register a whole site whose only page answers
  `500` → after the scan its **Status** reads **Error** (not **Active**).
- [ ] `KNOW-F15` · **Meta-noindex page** — Websites → **Add website** for a site
  whose HTML page carries `<meta name="robots" content="noindex">` (the render
  lane must run, so an HTML page, not a text file) → After the scan the page row
  shows the skipped reason `robots_noindex` with no chunks, and a search for its
  words returns nothing from it; a page whose noindex arrives as the
  `X-Robots-Tag` header reads the same.
- [ ] `KNOW-F16` · **Broken sync is visible** — Documents with a synced
  OneDrive or Google Drive folder (KNOW-F2's Microsoft 365 **Sync import**
  (`documents.onedrive.syncImport`)); make its owner's grant unusable (revoke
  the app's access in that Microsoft account, or as an operator set that
  member's row in app.user_cloud_authorizations to needs-reauth) and let the
  next sync run happen (≤ 15 min) → The folder row's **Source**
  (`tables.headers.source`) cell shows the badge **Reconnect needed**
  (`documents.syncHealth.badge.needsReauth`) in place of the OneDrive mark and
  its sync glyph (`documents.sourceType.oneDriveSynced` on hover), without a
  reload. Activating the badge opens a dialog titled **OneDrive access expired**
  (`documents.syncHealth.dialog.needsReauthTitle`) that names when the
  failures began and whose account the sync runs under; as that member it
  offers **Reconnect Microsoft 365** (`documents.onedrive.reconnect`), as any
  other member it says whom to ask. Reconnect and let the next run happen →
  the badge is gone without a reload and the row shows the OneDrive mark with
  its sync glyph again. A run failing for another reason (vendor unreachable)
  shows **Sync failed** (`documents.syncHealth.badge.failed`), whose dialog
  carries the error text and says Tale retries about every 15 minutes.
- [ ] `KNOW-F17` · **Record dialogs share one shape** — in a window at least
  768px wide, for each of Products, Contacts (a manually-created row), Websites
  and Knowledge entries: click a row and close the details, then open the same
  record from its row **Open menu** → **View** (`common.actions.view`); in the
  details choose **Edit** (`common.actions.edit`) → **Cancel**, then **Edit**
  again → change one field → **Save**; open the row menu's **Delete** and
  cancel; open the header create dialog → Row click and **View** open the same
  details dialog (`products.view.title`, `dialogs.contactInfo.title`,
  `websites.viewDialog.title`, `knowledgeEntries.viewDialog.title`): an image
  or icon tile beside the name, its summary and status badge, a divider, a
  two-column facts grid that ends in a copyable ID, then the record's own
  sections (a website's pages, an entry's version history). **Edit** replaces
  the details with the edit dialog in the same place; **Cancel** brings the
  details back and **Save** closes both, shows the success toast, and the row
  reads the change. The details, edit, create and upload dialogs share one
  width and are never shorter than a product's details; a short form keeps
  its buttons on the bottom edge. The delete confirmation names the record in
  bold with its consequence underneath (`products.delete.warning`,
  `contacts.deleteWarning`, `websites.delete.warning`,
  `knowledgeEntries.delete.warning`). Documents keep their full-width preview.
- [ ] `KNOW-F18` · **Website scan failure reason** — Websites → open a site
  whose table badge is **Error** (`websites.filter.status.error`) after a
  scan that never started (sandbox/runtime missing, or the crawler refused
  the host) and that has nothing indexed (`crawledPageCount` 0, no failed
  pages) → the view keeps that **Error** badge in the header; the body is a
  teaching empty (`websites.viewDialog.scanError.runtime` +
  `websites.viewDialog.scanEmpty.runtime` for a missing crawler runtime,
  `websites.pagesDialog.errorKind.dnsFailed` +
  `websites.viewDialog.scanEmpty.dns` for a host that does not resolve,
  `websites.viewDialog.scanError.generic` +
  `websites.viewDialog.scanEmpty.generic` otherwise) — never the raw sandbox
  JSON, `tale-sandbox-runtime`, or `getaddrinfo` dump, and never a hollow
  page row (`0 words` / `0 chunks`), search field, or `0 indexed` count.
  Hover the empty → the dump is on `title`. A site that already has indexed
  or failed pages keeps the list and a muted caption
  (`websites.viewDialog.scanError.*`) instead of the empty. Reload
  `/dashboard/{org}/websites` and reopen → the empty or caption is still
  the human line.
- [ ] `KNOW-F19` · **Source reads as icons** — Documents with an upload, a
  Microsoft 365 **One-time import** (`documents.onedrive.oneTimeImport`) and
  a synced folder (KNOW-F2), in German (`de`), with the window narrowed until
  the table scrolls sideways → every **Source** (`tables.headers.source`)
  cell stays on one line: the vendor mark (OneDrive, SharePoint, Google
  Drive; an upload arrow for an upload) and, beside a vendor mark, a smaller
  sync glyph — circling arrows for a sync, the same arrows struck through for
  a one-time import. Nothing wraps or runs into **RAG status**. Hovering a
  cell names it in words (`documents.sourceType.oneDriveSynced`,
  `documents.sourceType.oneDriveNotSynced`, `documents.sourceType.uploaded`),
  and a screen reader announces the same words as an image. A failed sync
  still shows its badge (KNOW-F16). Repeat in the dark theme → the marks and
  glyphs stay visible.

## Boundary & error tests

- [ ] `KNOW-B1` · **Required name** — KNOW-F4/KNOW-F5/KNOW-F6 manual entry:
  submit with an empty name field → Required-field validation fires; the
  dialog stays open and no row is created (reload confirms absence). _(NOTE:
  validation-on-first-keystroke is filed #1943.)_.
- [ ] `KNOW-B2` · **Invalid domain** — KNOW-F7 Websites → **Add website** →
  **Domain** = `not a url` → submit → Inline error **Enter a valid domain
  (e.g. example.com)** (`websites.validation.validDomain`); dialog stays open,
  nothing added (verified live).
- [ ] `KNOW-B3` · **Unsupported upload** — KNOW-F1 upload a genuinely
  unsupported type (e.g. `.exe`) or a file over the size cap (the cap is
  exactly 100 MB — a 100 MB file passes, 100 MB + 1 byte is rejected; enforced
  client-side AND server-side). **Note:** `.odt` is now a **supported** type
  (see KNOW-F8) — it must NOT be rejected here → Destructive toast
  **Unsupported file type** (`documents.upload.unsupportedFileType`), whose
  description lists the supported formats **including ODT**
  (`documents.upload.unsupportedFileTypeDescription`), or **File too large**
  (`documents.upload.fileTooLarge`); file not staged.
- [ ] `KNOW-B4` · **Indexing failure** — KNOW-F1 upload a small doc on the
  hermetic stack (no RAG backend) → Row badge reaches **Failed**
  (`documents.rag.status.failed`) rather than crashing; the row stays in the
  list. _(ENVIRONMENT: expected without the RAG service.)_.
- [ ] `KNOW-B5` · **Replacement guards** — Repeat KNOW-F12 with (a) a
  different extension, (b) the current file's unchanged bytes, (c) a
  controlled document in review, (d) an active legal hold, (e) an approved
  record whose replacement dialog is cancelled, and (f) **Delete** on a
  controlled document with an approved version in its history — approved, in
  review, or a later draft — plus a folder-delete on a folder containing one →
  (a) the dialog asks for the document's extension; (b) it reports unchanged
  content; (c) **Replace file** is absent while the record is in review; (d)
  the action and an already-open dialog are disabled; (e) no draft is opened;
  (f) the row's delete entry is disabled and reads **Protected controlled
  record** (`documents.record.blockedByRecord`), and the folder delete is
  refused with the record message — nothing inside is removed. In every
  rejected or cancelled case the row version, preview content, approval state,
  and RAG state remain unchanged.

## Accessibility (WCAG 2.1 AA)

- [ ] `KNOW-A1` · **Tables** → Each list DataTable has accessible column
  headers (`role="columnheader"`); rows are keyboard navigable.
- [ ] `KNOW-A2` · **Edit dialogs** → Create/edit/delete dialogs have a title,
  trap focus, and have labelled fields (**Topic**/**Content**/**Product
  name**/**Name**/**Domain**).
- [ ] `KNOW-A3` · **Empty states** → Each empty-state CTA is keyboard
  reachable — title `emptyStates.<entity>.title` for
  products/contacts/websites/knowledgeEntries, and
  `documents.emptyState.title` ("No documents yet") for **documents** (note:
  documents has no entry under the `emptyStates` group — it keeps its own key).
- [ ] `KNOW-A4` · **Upload + preview** → The drop-zone file input
  (`#document-file-upload`) is keyboard operable; the preview dialog traps
  focus and returns it to the row on **Close preview**.
- [ ] `KNOW-A5` · **Replace dialog** → **Replace file** is keyboard reachable;
  its dialog has an accessible title and labelled file input, announces
  validation/upload errors, cannot be dismissed while uploading, and restores
  focus to the row's **Open menu** button when closed.
- [ ] `KNOW-A6` · **View from the keyboard** → On any Knowledge list, Tab to a
  row's **Open menu** and press Enter: focus lands on **View**
  (`common.actions.view`), the first item, for a reader as well as a writer.
  Enter opens the details with focus inside and a named **Edit** button where
  the record is editable; Escape closes them and returns focus to that row's
  **Open menu** button — also after **Edit** → **Cancel** has brought the
  details back, and after a document preview opened from **View** closes.

## Performance

- [ ] `KNOW-P1` · **List first paint** → First page of any list route renders
  (create affordance or empty state visible) < 1.5 s, mock stack, local
  self-hosted backend.
- [ ] `KNOW-P2` · **Upload → Queued** → A small (<1 MB) TXT/PDF reaches a
  **Queued** badge < 3 s after **Upload**, mock stack, local backend.
