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

## Prerequisites

Stack up + signed in per [SETUP.md](SETUP.md). Have a small PDF/DOCX to hand for
the upload + preview tests. Create throwaway records and delete them after.

## Automated coverage

| Case(s)            | Status         | e2e spec                                    |
| ------------------ | -------------- | ------------------------------------------- |
| F1, F3, F4, F5, F6 | ✅ automated   | `knowledge.spec.ts`                         |
| F2, F7, F8         | ⛔ manual-only | — (OneDrive sync / website crawl / preview) |

## Functional tests

| ID  | Test                 | Steps (route + control)                                                                                                                                                                                                                                                                      | Expected                                                                                                                                                                                                                                                        |
| --- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Upload document      | Documents → **Import** (`documents.upload.importDocuments`) → **From your device** (`documents.upload.fromYourDevice`) → pick a file → **Upload** (`documents.upload.uploadDocuments`)                                                                                                       | Row appears with **Queued** (`documents.rag.status.queued`) for indexing                                                                                                                                                                                        |
| F2  | Documents organize   | Create a folder, move a doc; search; (if connected) Microsoft OneDrive sync                                                                                                                                                                                                                  | Folder filter + search work; sync option present when a Microsoft account is linked                                                                                                                                                                             |
| F3  | Knowledge entry CRUD | **Add** (`knowledgeEntries.addButton`) → topic (`knowledgeEntries.topic`) + content (`knowledgeEntries.content`) → save; then edit (`knowledgeEntries.editEntry`) and delete (`knowledgeEntries.delete.title`)                                                                               | Create/edit (`knowledgeEntries.toast.updateSuccess`)/delete all reflect in the list                                                                                                                                                                             |
| F4  | Product CRUD         | **Add product** (`products.addButton`) → name (`products.edit.labels.name`) → **Create**; edit (`products.edit.title`) → save (`products.edit.toast.success`); delete (`products.delete.title`)                                                                                              | List reflects each change                                                                                                                                                                                                                                       |
| F5  | Customer CRUD        | **Import** (`customers.importMenu.importCustomers`) → **Manual entry** (`customers.importMenu.manualEntry`) → name (`customers.name`) → **Import**; edit (`customers.editCustomer`) → `customers.updateSuccess`; delete (`customers.deleteCustomer`); search (`customers.searchPlaceholder`) | List reflects each change; search filters                                                                                                                                                                                                                       |
| F6  | Vendor CRUD          | **Import** (`vendors.importMenu.importVendors`) → **Manual entry** (`vendors.importMenu.manualEntry`) → name (`vendors.name`); edit (`vendors.editVendor`) → `vendors.updateSuccess`; delete (`vendors.deleteVendor`)                                                                        | List reflects each change                                                                                                                                                                                                                                       |
| F7  | Website              | Websites → add a URL; configure crawl/sync                                                                                                                                                                                                                                                   | URL added; crawl status surfaces                                                                                                                                                                                                                                |
| F8  | Document preview     | Open an uploaded document                                                                                                                                                                                                                                                                    | Preview renders inline (by file type); **Download file** (`documents.preview.downloadFile`) downloads it; **Close preview** (`documents.preview.closePreview`) closes. An unpreviewable type shows **Preview not available** (`documents.preview.notAvailable`) |

## Boundary & error tests

| ID  | Test             | Input                                          | Expected                                                          |
| --- | ---------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| B1  | Required name    | Save a product/customer/vendor with empty name | Required validation; save blocked                                 |
| B2  | Invalid URL      | Add a website with a malformed URL             | Validation error; not added                                       |
| B3  | Bad upload       | Upload an unsupported or oversized file        | Rejected with a clear error                                       |
| B4  | Indexing failure | Upload a corrupt document                      | Row shows **Failed** (`documents.rag.status.failed`), not a crash |

## Accessibility (WCAG 2.1 AA)

| ID  | Check            | Expected                                                                                 |
| --- | ---------------- | ---------------------------------------------------------------------------------------- |
| A1  | Tables           | `<caption>` (may be `sr-only`), `scope="col"` headers                                    |
| A2  | Edit dialogs     | Title + focus trap + labelled fields                                                     |
| A3  | Empty states     | The CTA in each empty state (`emptyStates.*.title`) is keyboard reachable                |
| A4  | Upload + preview | File picker operable by keyboard; the preview dialog traps focus and returns it on close |

## Performance

| ID  | Metric          | Target                             |
| --- | --------------- | ---------------------------------- |
| P1  | List render     | First page renders < 1.5 s         |
| P2  | Upload → queued | Small PDF reaches **Queued** < 3 s |

## Issues Found

| #   | Test ID | Route / URL | Severity | Description | Screenshot |
| --- | ------- | ----------- | -------- | ----------- | ---------- |
|     |         |             |          |             |            |

## Test summary

```
Area: Knowledge
Functional: ___/8   Boundary: ___/4   A11y: ___/4   Perf: ___/2
Issues: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
