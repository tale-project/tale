# Knowledge

> **Prefix** `KNOW-` · **Reset** none · **Cost** 64 boxes

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
- [ ] `KNOW-F29` · **Rename a folder** — Documents → a folder row's **Open
  menu** → **Rename** (`documents.actions.rename`) → the **Rename folder**
  dialog (`documents.folder.renameFolder`) opens on the current name → change
  it and submit → The toast reads `documents.folder.renamed` and the row shows
  the new name, also after a reload; a document search scoped to the folder
  still finds its files. Renaming to a sibling folder's name keeps the dialog
  open with `documents.folder.duplicateName` on the field, and a name with a
  slash shows `documents.folder.invalidName`. A synced folder's menu offers no
  **Rename**, and neither does the menu of a folder inside it or above it.
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
- [ ] `KNOW-F30` · **Source preview look** — In light and then in dark,
  preview a `.ts`, a `.json` and a `.txt` document, the first code file right
  after a reload → Characters line up in columns in all three; keywords,
  strings and numbers of the `.ts` and `.json` files take distinct colours on
  the same grey canvas as the `.txt` text, with no white or black box behind
  the code; every line number can be read out at 100 % zoom; while the first
  code file loads, no row moves or changes size when the colours arrive.
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
  (`tables.headers.source`) cell shows the OneDrive mark with a red unplugged
  plug where its sync arrows stood, tipped **Reconnect needed**
  (`documents.syncHealth.badge.needsReauth`) on hover and on keyboard focus,
  without a reload. Activating the mark opens a dialog titled
  **OneDrive access expired** (`documents.syncHealth.dialog.needsReauthTitle`)
  that names when the failures began and whose account the sync runs under;
  as that member it offers **Reconnect Microsoft 365**
  (`documents.onedrive.reconnect`), as any other member it says whom to ask.
  Reconnect and let the next run happen → the red glyph is gone without a
  reload and the row shows the sync arrows again
  (`documents.sourceType.oneDriveSynced` on hover). A run failing for another
  reason (vendor unreachable) shows a red warning sign tipped **Sync failed**
  (`documents.syncHealth.badge.failed`), whose dialog carries the error text
  and says Tale retries about every 15 minutes.
- [ ] `KNOW-F31` · **A synced Loop file reads Not supported** — Documents
  with a Microsoft 365 **Sync import** (`documents.onedrive.syncImport`) of a
  OneDrive folder holding a Microsoft Loop file (`.loop` — a Loop component
  sent in a Teams chat is stored as one under the sender's **Microsoft Teams
  Chat Files**) and a small `.txt` → after the sync run the Loop file's row
  reads **Not supported** (`documents.rag.status.unsupported`), never **Not
  indexed** (`documents.rag.status.notIndexed`), and its row **Open menu**
  offers no **Reindex** (`documents.actions.reindex`). Activating the badge
  opens **Document cannot be indexed**
  (`documents.rag.dialog.unsupported.title`) with the reason **This file type
  has no supported text extractor.**
  (`documents.rag.dialog.unsupported.reasons.unsupported_type`). The `.txt`
  row is **Queued** and moves on as any upload does. Let the next sync run
  happen (≤ 15 min) and reload `/dashboard/{org}/documents` → the Loop row
  still reads **Not supported**, with no **Reindex**.
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
  `websites.viewDialog.scanError.embedding` +
  `websites.viewDialog.scanEmpty.embedding` for an embedding provider that
  refused or failed the pages,
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
  and a screen reader announces the same words as an image. Uploads, agent
  files, knowledge entries and API imports carry their own glyph
  (`documents.sourceType.agent`, `documents.sourceType.knowledgeEntry`,
  `documents.sourceType.api`); a failed sync is a red glyph that Tab reaches
  (KNOW-F16). Open a Google Drive file's preview → the sidebar's **Source**
  (`documents.preview.sidebar.source`) shows the same mark and words, never
  `google_drive`. Repeat in the dark theme → the marks and glyphs stay
  visible.

- [ ] `KNOW-F20` · **Teams filter = audience, not context** — As a member of
  team A only, with one org-wide document, one document assigned to A and one
  assigned to another team B that you can still see as an admin (or seed via
  REST as owner) → The **Teams** filter offers **Organization-wide**
  (`documents.filter.teams.orgWide`), **My teams**
  (`documents.filter.teams.mine`) and every team of the org by name (the
  directory, not only your own); **Organization-wide** keeps only the untagged
  row, **My teams** only the A row, picking B by name only the B row, and any
  two selections union; the choice lands in the URL as `?teams=org,mine,…`
  and survives a reload; **Clear filters** empties it.

- [ ] `KNOW-F21` · **Teams column names the audience** — With one org-wide
  document, one assigned to a single team, one assigned to three teams and one
  folder inside a project → The **Teams** column (`tables.headers.teams`) reads
  a globe plus `documents.teamTags.orgWide` for the first, one team NAME in a
  chip (never an id) for the second, one name plus `+2`
  (`documents.teamTags.moreTeams`) for the third with all three in the cell's
  title, and a folder glyph plus `documents.teamTags.projectScoped` for the
  fourth; every row's glyph and the text beside it sit on the same offset as
  the **Document** column's, and the projects list's **Sharing** column
  (PROJ-F23) reads the same way. Delete one of the three teams in Settings →
  the row it tagged reads `documents.teamTags.unknownTeam` rather than
  dropping the team and reading as unrestricted.
- [ ] `KNOW-F22` · **Embedding failures end honestly** — With an embedding
  model configured, provoke each of these and watch the row's **RAG status**
  and the dialog: (a) a wrong **Base URL** (a provider's native endpoint
  pasted where its OpenAI-compatible base belongs) → **Failed** with the
  provider sentence (`…could not serve the request; indexing is retried
  automatically`), and once the job's retries run out the row STAYS
  **Failed** with that sentence — it never flips to **Indexing** with no job
  behind it; (b) a model that answers another vector width than **Vector
  width** states → **Failed** at once, naming both widths and pointing at
  Settings → Data residency → Embedding model, with no further retries;
  (c) a provider that caps the texts per request (DashScope-compatible
  gateways: 10 or 25) → a document with more chunks than the cap still
  indexes to **Indexed**, the platform log noting the cap it learned.
- [ ] `KNOW-F23` · **A fact deep in a short document is answered** — Upload a
  ~1 KB `.txt` whose only distinctive sentence ("The project codename is
  BLUE-HERON-4471.") sits after ~600 characters of filler; wait for
  **Indexed**; in a new chat ask "What is the project codename? Cite the
  source." → The answer names BLUE-HERON-4471 with the file as its source;
  the expanded **Searching the workspace** tool call shows the hit's snippet
  as the whole passage (no `…(+N chars)` cut before the sentence).
- [ ] `KNOW-F24` · **A product or contact answers from all its fields** —
  Create a product with a price, a **currency**, a description holding a
  code and tags, and a contact with an email, a phone and a **locale**; in a
  new chat ask for the product's price and currency and the code in its
  description, then for the contact's locale → Both answers state the stored
  values; the expanded tool call's product row carries `currency` and
  `description`, the contact row `locale` — never "not specified" for a
  field the record has.


- [ ] `KNOW-F25` · **A failed documents read keeps the folders and says so** —
  With folders at the root, block `*/api/app/documents/paginated*` in
  DevTools (or answer it 500) and open `/dashboard/{org}/documents` → after
  the retries the folders stay listed under one notice **Couldn't load the
  documents here. Only the folders are listed until the documents load.**
  (`documents.loadFailed`) with **Try again**, and the count reads
  **Showing the first N documents — the rest couldn't be loaded**
  (`common.pagination.showingLoadedFailed`), never **Showing all N
  documents**. A search that matches no folder reads **No results among the
  loaded items** and keeps its search box. With more than 20 folders, a
  search that matches them all, and clearing it, keep every folder listed.
  A folder that holds only a
  subfolder, read with the documents unblocked, lists it with no notice and
  **Showing all 1 document**; an empty folder read with them blocked shows
  the table's error state **Something went wrong** with **Try again**.
  Unblock → **Try again** from the keyboard: focus moves to the
  **Documents** region, the documents appear without navigating away, and
  the count is exact. A search, a filter and a **Rename folder** draft left
  open survive a background retry that fails and one that heals (switch to
  another window and back). No toast.
- [ ] `KNOW-F26` · **Entry content renders as Markdown** — Knowledge entries →
  **Add entry** (`knowledgeEntries.addButton`) with content
  `Open **only on Thursdays**`, a `- ` bullet list and
  `![plan](https://example.com/plan.png)`; save, edit the content once more,
  then open the row → The details show bold text and
  a real list (no literal asterisks) for the current version and for the
  superseded one under **Version history**; no image is requested (network
  panel shows no `plan.png`). The table's **Content** column shows one line
  of plain text with the decoration stripped.
- [ ] `KNOW-F27` · **The copyable id is named as a version id** — Open an
  entry's details → The copyable identifier at the bottom is labelled
  **Version ID** (`knowledgeEntries.viewDialog.entryId`) with a caption
  saying a new ID is issued on every edit and that the topic identifies the
  entry (`knowledgeEntries.viewDialog.entryIdHint`). **Edit** the content,
  save, reopen the details → the Version ID differs from the one copied
  before while the topic and **Version history** carry the previous version.
- [ ] `KNOW-F28` · **An Owner or Admin may pick any team** — Signed in as an
  Owner who is a member of none of the org's teams (Settings › Teams lists at
  least one synced team) → Documents → **Upload documents** → **Assign to
  teams**, a row's **Assign team**, **New folder** → **Team**, and the
  OneDrive / Google Drive import dialogs' team picker → Each lists every team
  of the organization, synced ones included, as the documents guide says. As
  an Editor of one team → the same pickers list that team only. Assign a
  document to a team you are not in → its preview sidebar names that team.
- [ ] `KNOW-F32` · **Scan now** — Websites → a site whose badge is **Error**
  (`websites.filter.status.error`) or **Active** → row **Open menu** →
  **Scan now** (`websites.scanNow`) → toast **Scan started**
  (`websites.toast.scanStarted`); the badge turns **Scanning**
  (`websites.filter.status.scanning`) without a reload, and **Scan now**
  leaves the menu while the scan runs. The details dialog offers the same
  **Scan now** beside **Edit**. A paused site offers **Resume scanning**
  (`websites.resumeScanning`) in its place; a Member (no knowledge write)
  sees neither.
- [ ] `KNOW-F33` · **The table follows a scan** — Websites → **Add website**
  for a site with a few dozen pages, then leave the page open and do not
  reload → the row appears **Scanning**; within a minute or two the
  **Indexed** (`websites.indexed`) count starts moving and keeps moving as
  pages land, and the badge turns **Active** (or **Error**) by itself when
  the scan ends. Open the row's details while it still scans → the
  **Website pages** list (`websites.pagesDialog.title`) grows with the count,
  without closing and reopening. Add a second site while the first still
  scans → its count starts moving within seconds too, not only once the
  first site's step has ended.
- [ ] `KNOW-F34` · **Notice when chat cannot search websites** — With no
  embedding model (Settings › Data residency → **Embedding model** off): as
  an Editor open Websites → a warning above the table reads **Chat can't
  search these websites yet** (`websites.searchNotice.title`) and points at
  an admin (`websites.searchNotice.askAdmin`), with no link. As an Owner of
  an organization that has an AI provider → the dashboard banner **Knowledge
  search is off** (`settings.dataResidency.orgEmbedding.banner.title`) names
  documents and websites, and the page shows no second notice; with no AI
  provider yet → the page notice carries **Configure embedding model**
  (`websites.searchNotice.configureCta`), which opens Settings › Data
  residency. As the Editor, keep Websites open while an admin saves an
  embedding model in another session → the notice disappears without a
  reload, and every site crawled before the model turns **Scanning** by
  itself. (The Owner's banner follows in the tab that saved the model; in
  another tab it reads the setting on the next load.)
- [ ] `KNOW-F35` · **A scan survives a restart** — Websites → add a site
  with a few hundred pages and wait until **Indexed** (`websites.indexed`)
  shows a few dozen. While the badge reads **Scanning**
  (`websites.filter.status.scanning`), restart the platform (the backend
  process, or the platform container) → once it is back the badge still
  reads **Scanning**, never **Error** and never **Paused**
  (`websites.scanPausedBadge`), and the row menu offers no **Scan now**.
  Within about five minutes the count moves again by itself; on a site
  whose pages need the browser it can take up to a quarter of an hour. Open
  the details → the pages crawled before the restart keep their earlier
  crawled time: the scan continued, it did not begin again. Restart once
  more while it still scans → the same again. Then stop the backend without
  warning (`kill -9`, or `docker kill` on the backend worker) → the same,
  a couple of minutes later.
- [ ] `KNOW-F36` · **Failed and skipped pages have a door** — Websites → open
  a site with indexed pages beside failed and skipped ones (a URL list with a
  `noindex` page and a 404 page next to working ones) → the pages header
  reads `websites.indexed` and `websites.pagesDialog.failedPages`, and that
  count is a link-styled button; above the list a segmented control
  (`websites.pagesDialog.filter.label`) offers
  `websites.pagesDialog.filter.all`, `websites.pagesDialog.filter.failed` and
  `websites.pagesDialog.filter.skipped` with their counts, and is absent while
  no page failed or was skipped. Click the count → the **Failed** segment is
  checked and the list holds only rows labelled `websites.pagesDialog.failed`,
  from the top, with its own **Load more**; **Skipped** holds only
  `websites.pagesDialog.skipped` rows; a segment at 0 shows
  `websites.pagesDialog.noFailedPages` or
  `websites.pagesDialog.noSkippedPages`; **All** restores the whole list. A
  scan that moves the row while **Failed** is open re-reads the failed pages,
  not all of them; the content search ignores the filter. Keyboard: Tab
  reaches the segments and the arrow keys switch them.

## Boundary & error tests

- [ ] `KNOW-B1` · **Required name** — KNOW-F4/KNOW-F5/KNOW-F6 manual entry:
  submit with an empty name field → Required-field validation fires; the
  dialog stays open and no row is created (reload confirms absence). _(NOTE:
  validation-on-first-keystroke is filed #1943.)_.
- [ ] `KNOW-B2` · **Invalid domain** — KNOW-F7 Websites → **Add website** →
  **Domain** = `not a url` → submit → Inline error **Enter a valid domain
  (e.g. example.com)** (`websites.validation.validDomain`); dialog stays open,
  nothing added (verified live). Then **Domain** = `https://example.org:8443`
  → **Save** → ONE toast **Couldn't add website** (`websites.toast.addError`)
  whose description is the https-host sentence
  (`websites.toast.addErrorReason.domainInvalid`); `https://169.254.169.254/`
  → the same title with the not-reachable sentence
  (`websites.toast.addErrorReason.notCrawlable`). Never a bare title, never a
  second generic toast behind it.
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
- [ ] `KNOW-B6` · **Duplicate folder name is named** — Documents → **New
  folder** `Reports`, then **New folder** `reports` beside it (a project's
  files tab and an automation's uploads panel behave the same) → toast **A
  folder with this name already exists** (`documents.folder.duplicateName`),
  never the generic **Couldn't create folder**; nothing is created.
- [ ] `KNOW-B7` · **A refused product names its field** — Products → **Add
  product** → **Pricing & inventory** with currency `zzz` → **Next** stays on
  the step and names the field (`products.edit.validation.currency`); a
  refusal the form does not know (an image URL on a private host, pasted
  under **Or paste a URL**) reaches **Create** as the toast **Couldn't create
  product** (`products.create.toast.error`) with a description starting
  `imageUrl:`; the same for **Edit**.
- [ ] `KNOW-B9` · **Price and stock are refused at the step** — **Add
  product** → **Pricing & inventory**: price `-5` → **Next** stays on the
  step with **Price must be 0 or more**
  (`products.edit.validation.priceNonNegative`) under **Price**; price `1e20`
  → `products.edit.validation.priceTooLarge`; stock `-3` →
  `products.edit.validation.stockNonNegative`; stock `1.5` →
  `products.edit.validation.stockInteger`; **Review** is never shown. Price
  `12.50`, stock `3` → **Next** → **Create** → the row shows them. **Edit** a
  product to price `-5` → **Save** → the same field error, nothing saved.
- [ ] `KNOW-B10` · **A refused image says why** — **Add product** → **Basics**:
  upload an SVG carrying `onload="alert(1)"` → under **Image** and as a toast,
  `products.edit.imageActiveContent` (names scripts/event handlers), never
  "try again"; upload a `.txt` renamed `.png` →
  `products.edit.imageUnsupported`; a 6 MB PNG →
  `products.edit.imageTooLarge`. A passive SVG (`<rect/>` only) uploads and
  previews; **Remove image** clears the message.
- [ ] `KNOW-B11` · **An import lists its refused rows by line** — Products →
  **Add product** → **From your device** with a CSV whose header is line 1
  and whose lines 2–6 are: a good row; an empty name; price `notanumber`;
  currency `EURO`; status `flying` → **Import** → toast **Import successful**
  (`products.import.success`) "Imported 1 products, 4 failed"; the dialog
  stays open with the banner **4 rows were not imported**
  (`common.import.rowErrorsTitle`) listing `Row 3: name: must not be blank`,
  `Row 4: price: must be a number`, `Row 5: currency: …`, `Row 6: status:
  must be one of …` (`common.import.rowError`); the table shows the one
  product, and no product carries `flying` or status **Draft** from an
  unknown status. A file whose every row is refused → toast **No products
  were imported** (`products.noneImported`) naming the first line, nothing
  created. Contacts → **Upload contacts** with a CSV whose line 3 has no
  email and line 4 an email already in the directory → the same banner:
  `Row 3: email: must not be blank`, `Row 4: A contact with this email
  already exists` (`contacts.import.errorCodes.duplicate_email`); line 2
  imported. Reopening either dialog starts clean.
- [ ] `KNOW-B12` · **A deleted product's image goes with it** — Products →
  **Add product** with an uploaded PNG → **Create** → open the details and
  copy the image address (`/api/app/products/images/<id>?orgId=…`); with the
  signed-in session, GET it → 200. Delete the product → the same GET → 404
  `PRODUCT_IMAGE_NOT_FOUND`, also for the uploader, also after a minute; the
  object is gone from the org store. **Edit** another product with an
  uploaded image → **Remove image** → **Save** → its old address → 404; the
  same after replacing it with a second upload. Two products created with
  the same pasted managed address → delete one → the other's image still
  loads. Settings › Governance › Legal holds with an org-wide hold active →
  **Delete** on a product → toast **Couldn't delete product**
  (`products.actions.deleteFailed`), the row stays; **Remove image** →
  **Save** succeeds and the old address still answers 200 for the uploader.
- [ ] `KNOW-B8` · **`http://` in each add-website mode** — Websites → **Add
  website** → **Whole website** → **Domain** = `http://example.net` → **Save**
  → the field shows the https-host sentence inline
  (`websites.toast.addErrorReason.domainInvalid`), no request leaves, no
  toast. Switch to **URL list** → the hint under **URLs**
  (`websites.urlListHint`) says pages are fetched over HTTPS and an `http://`
  line is fetched as `https://`; paste `http://example.org/` → **Save** → the
  source appears and its page is stored as `https://example.org/`.
- [ ] `KNOW-B13` · **A value the door would refuse is named in the form** —
  Contacts → **Add** → **Manual entry**
  (`contacts.importMenu.manualEntry`): paste a 301-character **Name** →
  **Save** → under the field **Name must be 300 characters or fewer**
  (`common.validation.maxLength`), nothing sent; the same for a
  51-character **Phone**, a 21-character **Locale** (`en-` and 18 letters)
  and an **Email** with 65 characters before the `@` → **Use at most 64
  characters before the @** (`common.validation.emailLocalPart`); 300
  characters of name with spaces around them save trimmed. **Edit** a contact → the same rules on **Save**.
  Products → **Add product** → **Or paste a URL**
  (`products.edit.pasteUrl`) → `example.com/cat.png` → **Next** stays on
  **Basics** with `products.edit.validation.imageUrl` under **Image URL**;
  so does `/images/cat.png` (only the path an upload returned passes);
  `https://` in front of it passes; **Edit** → the same on **Save**. No
  toast in any of these, and never one reading `invalid body`. Paste
  `http://169.254.169.254/cat.png` → **Create** → the toast's second line
  reads `imageUrl: must name a public host — …`, never
  `imageUrl: Invalid input`.
- [ ] `KNOW-B14` · **An import over the row cap asks for a split** —
  Products → **Add product** → **From your device** with a CSV of 1,001
  product rows → **Import** → toast **Couldn't import products**
  (`products.import.error`) whose second line (`common.import.tooManyRows`)
  names the 1001 rows and the cap of 1000; DevTools Network shows no
  `POST /api/app/products/bulk` and no product is created. The same file cut
  to 1,000 rows imports. Contacts → **Upload contacts** with 1,001 rows →
  the same line under **Import error** (`contacts.import.error`), nothing
  sent. Repeat in German and French: the line reads in the locale.
- [ ] `KNOW-B15` · **Clearing a contact's phone clears it** — Contacts → a
  manually entered contact with a **Phone** → **Edit** → clear **Phone** →
  **Save** → toast **Contact updated** (`contacts.updateSuccess`); reload →
  the details show no phone. DevTools Network: the
  `POST /api/app/contacts/<id>` body carries `"phone":null`, never
  `"phone":""`, which the door reads as a phone that was not sent.
- [ ] `KNOW-B16` · **A cloud listing that fails says so once** — With
  Microsoft 365 connected, block `*/api/app/onedrive/list-files*` in
  DevTools (Network → request blocking), then **Documents** → **Upload
  documents** → **From Microsoft 365** (`documents.upload.fromMicrosoft365`)
  → after the listing's retries (a few seconds) one destructive toast
  **Couldn't load items** (`documents.onedrive.loadFailed`) whose line is
  `common.errors.connectionLost`, in the page's language — never one per
  retry, never the provider's own answer (`OneDrive API error: …`); the
  picker stays open. Unblock and reopen → the files list. The same with
  Google Drive connected, `*/api/app/google-drive/list-files*` and **From
  Google Drive** (`documents.upload.fromGoogleDrive`) →
  `documents.googledrive.loadFailed`. With the picker open, remove Tale's
  access in the Google Account's third-party access settings, then open
  another folder → the picker closes and **Connect Google Drive**
  (`documents.googledrive.notConnected`) opens, with no toast — never
  **Couldn't load items**.
- [ ] `KNOW-B17` · **A library that cannot load says so** — With more than
  20 knowledge entries, block `*/api/app/knowledge-entries?limit=*` in
  DevTools (Network → request blocking) and reload **Knowledge entries** →
  after the retries (a few seconds) the table shows the error state with
  **Try again** (`common.errors.tryAgain`), never **No knowledge entries
  yet** (`emptyStates.knowledgeEntries.title`); unblock → **Try again** → the
  rows return without a reload. Then block only
  `*/api/app/knowledge-entries?limit=20&cursor=*`, search for an entry on the
  second page → one notice above the table
  (`knowledgeEntries.refreshFailed`) with **Try again**, the body reads **No
  results among the loaded items** (`common.search.noLoadedResults`) — no
  skeleton — and Network shows one run of four requests for that page, not a
  stream; a search the first page matches keeps its rows over **the rest
  couldn't be loaded** (`common.pagination.showingLoadedFailed`); unblock →
  **Try again** → the match appears with the search text and any selected
  rows kept. No toast in either case.
- [ ] `KNOW-B18` · **A version history that cannot load says so** — Open an
  entry edited at least once with `*/api/app/knowledge-entries/*/versions*`
  blocked → **Version history** (`knowledgeEntries.viewDialog.history`)
  reads **Couldn't load the version history.**
  (`knowledgeEntries.viewDialog.historyLoadFailed`) with **Try again**, the
  current content stays readable, and the disabled **Retry indexing** badge
  is not the history's retry; unblock → **Try again** → the replaced version
  appears. An entry never edited reads
  `knowledgeEntries.viewDialog.historyEmpty`; while the read runs, the
  section reads `knowledgeEntries.viewDialog.historyLoading`.
- [ ] `KNOW-B19` · **Access that ends mid-import lands in the connect
  dialog** — With Microsoft 365 connected and a OneDrive folder of 40 or so
  small files: **Documents** → **Upload documents** → **From Microsoft 365**
  (`documents.upload.fromMicrosoft365`) → select the folder → **Import (1)**
  (`documents.onedrive.importCount`) → **Import 1 item**
  (`documents.onedrive.importItems`); while **Import started**
  (`documents.onedrive.importStarted`) shows, open the same picker in a
  second tab and choose **Disconnect Microsoft 365**
  (`documents.onedrive.disconnect`) → back in the first tab the picker closes
  and **Reconnect Microsoft 365** (`documents.onedrive.reconnect`) opens:
  its first line (`documents.cloudImport.importInterrupted`) says that
  access ended during the import and how many of the files were imported
  (**N of M files were imported and are kept.**), the second
  (`documents.cloudImport.reconnectToImportRest`) says to reconnect and
  import the same files again; no toast — the **Import started** notice is
  gone and no **Import failed** follows. Close it → the library shows those
  N files. Reconnect, select the same folder again and import → **Import
  completed** (`documents.onedrive.importCompleted`) reads **M of M files
  imported**, and each file is in the library once. Disconnect again after
  selecting the folder but before choosing **Import 1 item** → the same
  dialog reads **No files were imported.** The same with Google Drive
  (**Disconnect Google Drive**, **Reconnect Google Drive**). Repeat in German
  and French: both sentences read in the page's language.
- [ ] `KNOW-B20` · **A partial import says so in one warning** — With
  Microsoft 365 connected and a OneDrive folder holding two small files and
  one over 512 MiB (a video, a disk image): import the folder → after
  **Import started**, one amber warning toast, not a red one, titled
  **Imported 2 of 3 files** (`documents.cloudImport.importedPartial`) whose
  line names the large file beside the size cap's sentence
  (`documents.cloudImport.failedFileDetail`: `<name>: The file is … bytes;
  the limit is 512 MiB`, or `The file exceeds the 512 MiB limit`);
  the picker stays on its settings step and the two small files are in the
  library. Replace the large file with an empty one and import again → the
  same title with no second line (an empty file fails as a fault, which
  has no words), and never a provider's text such as `Failed to download
  file: …`. A folder holding only the large file → a red **Import failed**
  (`documents.onedrive.importFailed`) with the size line; one holding only
  the empty file → **Import failed** with **0 of 1 files imported**
  (`documents.onedrive.filesImportedCount`). The same with Google Drive, and
  in German and French: the titles read in the page's language, the size
  sentence stays the door's own.

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
- [ ] `KNOW-A7` · **Retry from the keyboard** → In the `KNOW-B17` and
  `KNOW-B18` states, Tab reaches **Try again** with a visible focus ring;
  Enter or Space runs it and focus moves to the **Knowledge entries** region
  or the **Version history** section — never to the page body; a screen
  reader announces each failure once (the notice is an alert), reads the
  retry as busy while it runs, and announces the notice again when a retry
  fails again. Tab to **Try again** without pressing it and let a background
  refresh fail again (keep the read blocked, then make any write that
  refreshes the list, or a hub upload for an open history) → focus stays on
  that **Try again**; unblock and let the next refresh work → focus lands on
  the region or the section, never on the page or the dialog frame. In the
  first `KNOW-B17` state (nothing loaded), focus **Try again** without
  pressing it, switch to another window and back → while the refresh runs,
  and after the error state returns, focus is on the **Knowledge entries**
  region, never on the page.

## Performance

- [ ] `KNOW-P1` · **List first paint** → First page of any list route renders
  (create affordance or empty state visible) < 1.5 s, mock stack, local
  self-hosted backend.
- [ ] `KNOW-P2` · **Upload → Queued** → A small (<1 MB) TXT/PDF reaches a
  **Queued** badge < 3 s after **Upload**, mock stack, local backend.
