# Knowledge — Manual Test Plan

> **Purpose**: Exercise the knowledge surfaces — documents (upload + RAG
> indexing + preview), manual knowledge entries, and the structured catalogs
> (products, customers, vendors, websites). These feed the chat agent's reads
> and RAG.

## Scope & routes

| Surface           | Route                                |
| ----------------- | ------------------------------------ |
| Documents         | `/dashboard/{org}/documents`         |
| Knowledge entries | `/dashboard/{org}/knowledge-entries` |
| Products          | `/dashboard/{org}/products`          |
| Customers         | `/dashboard/{org}/customers`         |
| Vendors           | `/dashboard/{org}/vendors`           |
| Websites          | `/dashboard/{org}/websites`          |

(All six live under the pathless `_knowledge` layout segment — it does not appear
in the URL.)

## Prerequisites

Bring the stack up and sign in per [SETUP.md](SETUP.md). Have a small
PDF/DOCX/ODT/TXT to hand for the upload + preview tests. Create throwaway records
and delete them after.

> **Agent note**: These are DataTable list pages. The header create affordance is
> a split/menu button (e.g. **Upload documents**, **Add product**) that opens a
> menu — pick **From your device** / **Manual entry** inside it; it is not a
> direct dialog. Row edit/delete live behind each row's **Open menu**
> (`common.actions.openMenu`) 3-dot button — only manually-created rows expose
> them. Verify every write by reloading the route and reading the row back, never
> by the toast. Document **indexing** needs the RAG service, which is NOT in the
> hermetic mock stack, so an uploaded doc lands **Queued** then flips to
> **Failed** (terminal here) — both are valid hermetic landing states.

## Automated coverage

| Case(s)    | Status         | e2e spec                                                                          |
| ---------- | -------------- | --------------------------------------------------------------------------------- |
| F1         | ✅ automated   | `knowledge.spec.ts` (uploads a document, asserts Queued/Failed)                   |
| F9         | ✅ automated   | `knowledge.spec.ts` (uploads a `.odt`, asserts it is accepted → Queued/Failed)    |
| F6         | ✅ automated   | `knowledge.spec.ts` (vendor create-via-CSV → edit → delete)                       |
| F1         | 🔶 partial     | `navigation.spec.ts` (documents route renders to its empty state)                 |
| F3, F4, F5 | ⛔ manual-only | — `knowledge.spec.ts` parametrizes only `vendors`, not entries/products/customers |
| F2, F7, F8 | ⛔ manual-only | — (OneDrive sync / website crawl / document preview)                              |

Legend: ✅ fully automated · 🔶 partially automated · ⛔ manual-only (no spec).

## Functional tests

| ID  | Test                 | Steps (route + control)                                                                                                                                                                                                                                                                                                                                                                                                              | Expected (verifiable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Upload document      | Documents → header **Upload documents** menu (`documents.upload.importDocuments`) → **From your device** (`documents.upload.fromYourDevice`) → in the **Upload documents** dialog (title = `documents.upload.importDocuments`) attach a small PDF/TXT via the drop zone → **Upload** (`documents.upload.uploadDocuments`)                                                                                                            | A row carrying the filename appears with a RAG-status badge **Queued** (`documents.rag.status.queued`); on the hermetic stack it then flips to **Failed** (`documents.rag.status.failed`) once indexing runs with no RAG backend. Reload `/documents`: the row is still present.                                                                                                                                                                                                                                                                                    |
| F2  | Documents organize   | Documents → **Upload documents** menu → **New folder** (`documents.folder.newFolder`); create a folder, then move a doc into it; use search. (Microsoft 365 sync **From Microsoft 365** (`documents.upload.fromMicrosoft365`) appears in the menu only when `hasMicrosoftAccount`.)                                                                                                                                                  | Folder filter + search narrow the list; the **From Microsoft 365** menu item is present iff a Microsoft account is linked. Reload: the folder persists.                                                                                                                                                                                                                                                                                                                                                                                                             |
| F3  | Knowledge entry CRUD | Knowledge entries → **Add entry** (`knowledgeEntries.addButton`) → **Topic** (`knowledgeEntries.topic`) + **Content** (`knowledgeEntries.content`) → **Save** (`common.actions.save`); then row **Open menu** → **Edit** (dialog title `knowledgeEntries.editEntry`) → change topic → Save; then row menu → **Delete** (dialog title `knowledgeEntries.delete.title`) → confirm                                                      | After create, the topic appears in the list AND survives a reload of `/knowledge-entries` (verified live: persisted). Edit toast = `knowledgeEntries.toast.updateSuccess` ("Knowledge entry updated"); the renamed topic survives reload. After delete + reload the row is gone.                                                                                                                                                                                                                                                                                    |
| F4  | Product CRUD         | Products → header **Add product** menu (`products.addButton`) → **Manual entry** (`products.importMenu.manualEntry`) → **Product name** (`products.edit.labels.name`) → submit (create dialog title `products.create.title`); then row **Open menu** → **Edit** (dialog title `products.edit.title`) → rename → Save; then row menu → **Delete** (dialog title `products.delete.title`) → confirm                                    | Create toast = `products.create.toast.success` ("Product created successfully"); edit toast = `products.edit.toast.success` ("Product updated successfully"). Each change survives a reload of `/products`. After delete + reload the row is gone (delete toast `products.actions.deleteSuccess`).                                                                                                                                                                                                                                                                  |
| F5  | Customer CRUD        | Customers → header **Import customers** menu (`customers.importMenu.importCustomers`) → **Manual entry** (`customers.importMenu.manualEntry`) → **Name** (`customers.name`) → **Import** (`common.actions.import`); then row **Open menu** → **Edit** (dialog title `customers.editCustomer`) → rename → Save; **Delete** (dialog title `customers.deleteCustomer`); search via **Search customers** (`customers.searchPlaceholder`) | Edit toast = `customers.updateSuccess` ("Customer updated successfully"); the row survives reload of `/customers`. Search narrows the list to the matching name. After delete + reload the row is gone.                                                                                                                                                                                                                                                                                                                                                             |
| F6  | Vendor CRUD          | Vendors → header **Import vendors** menu (`vendors.importMenu.importVendors`) → **Manual entry** (`vendors.importMenu.manualEntry`) → enter one `email,name` line → **Import** (`common.actions.import`); then row **Open menu** → **Edit** (dialog title `vendors.editVendor`) → rename → Save; **Delete** (dialog title `vendors.deleteVendor`) → confirm                                                                          | Edit toast = `vendors.updateSuccess` ("Vendor updated successfully"); the row survives reload of `/vendors`. After delete + reload the row is gone. (This is the path `knowledge.spec.ts` automates.)                                                                                                                                                                                                                                                                                                                                                               |
| F7  | Website add          | Websites → **Add website** (`websites.addButton`) → in the **Add website** dialog (title `websites.addWebsite`) fill **Domain** (`websites.domain`, placeholder `websites.urlPlaceholder` = "example.com") with `example.com`, pick a **Scan interval** (`websites.scanInterval`) → submit                                                                                                                                           | Success toast = `websites.toast.addSuccess` ("Website added successfully"). The domain row appears AND survives a reload of `/websites` (verified live: persisted). Crawl runs only with the crawler service — out of the hermetic stack — so a scan status need not progress here.                                                                                                                                                                                                                                                                                 |
| F8  | Document preview     | Documents → click a previewable row (PDF/DOCX/XLSX/image/text)                                                                                                                                                                                                                                                                                                                                                                       | Preview renders inline by file type; **Download file** (`documents.preview.downloadFile`) triggers a download; **Close preview** (`documents.preview.closePreview`) closes the dialog and returns focus to the row. An unpreviewable type shows **Preview not available** (`documents.preview.notAvailable`).                                                                                                                                                                                                                                                       |
| F9  | Upload ODT           | Documents → **Upload documents** (`documents.upload.importDocuments`) → **From your device** (`documents.upload.fromYourDevice`) → attach a small **`.odt`** file → **Upload** (`documents.upload.uploadDocuments`)                                                                                                                                                                                                                  | `.odt` is **accepted** (it was previously rejected as unsupported): a row with the filename appears and reaches a RAG badge **Queued** (`documents.rag.status.queued`) → **Failed** (`documents.rag.status.failed`) on the hermetic stack (no RAG backend). The upload dialog's drop-zone hint reads **"PDF, DOCX, ODT, XLSX, CSV, TXT up to {maxSize} MB"** (`documents.upload.dropZoneDescription`). ODT text extraction (headings/lists/tables) is unit-tested in `extraction/odt.test.ts`; full RAG indexing needs the RAG service (out of the hermetic stack). |

## Boundary & error tests

| ID  | Test               | Input                                                                                                                                                                  | Expected (verifiable)                                                                                                                                                                                                                                                                |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Required name      | F4/F5/F6 manual entry: submit with an empty name field                                                                                                                 | Required-field validation fires; the dialog stays open and no row is created (reload confirms absence). _(NOTE: validation-on-first-keystroke is filed #1943.)_                                                                                                                      |
| B2  | Invalid domain     | F7 Websites → **Add website** → **Domain** = `not a url` → submit                                                                                                      | Inline error **Enter a valid domain (e.g. example.com)** (`websites.validation.validDomain`); dialog stays open, nothing added (verified live).                                                                                                                                      |
| B3  | Unsupported upload | F1 upload a genuinely unsupported type (e.g. `.exe`) or a file over the size cap. **Note:** `.odt` is now a **supported** type (see F9) — it must NOT be rejected here | Destructive toast **Unsupported file type** (`documents.upload.unsupportedFileType`), whose description lists the supported formats **including ODT** (`documents.upload.unsupportedFileTypeDescription`), or **File too large** (`documents.upload.fileTooLarge`); file not staged. |
| B4  | Indexing failure   | F1 upload a small doc on the hermetic stack (no RAG backend)                                                                                                           | Row badge reaches **Failed** (`documents.rag.status.failed`) rather than crashing; the row stays in the list. _(ENVIRONMENT: expected without the RAG service.)_                                                                                                                     |

## Accessibility (WCAG 2.1 AA)

| ID  | Check            | Expected                                                                                                                                                                                                                                                                        |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Tables           | Each list DataTable has accessible column headers (`role="columnheader"`); rows are keyboard navigable.                                                                                                                                                                         |
| A2  | Edit dialogs     | Create/edit/delete dialogs have a title, trap focus, and have labelled fields (**Topic**/**Content**/**Product name**/**Name**/**Domain**).                                                                                                                                     |
| A3  | Empty states     | Each empty-state CTA is keyboard reachable — title `emptyStates.<entity>.title` for products/customers/vendors/websites/knowledgeEntries, and `documents.emptyState.title` ("No documents yet") for **documents** (note: documents uses this key, NOT `emptyStates.documents`). |
| A4  | Upload + preview | The drop-zone file input (`#document-file-upload`) is keyboard operable; the preview dialog traps focus and returns it to the row on **Close preview**.                                                                                                                         |

## Performance

| ID  | Metric           | Target                                                                                                                          |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| P1  | List first paint | First page of any list route renders (create affordance or empty state visible) < 1.5 s, mock stack, local self-hosted backend. |
| P2  | Upload → Queued  | A small (<1 MB) TXT/PDF reaches a **Queued** badge < 3 s after **Upload**, mock stack, local backend.                           |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Knowledge
Functional: ___/9   Boundary: ___/4   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
