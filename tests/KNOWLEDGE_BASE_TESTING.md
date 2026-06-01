# Knowledge Base Testing Guide (AI-Directed)

> **Purpose**: Exercise the six knowledge sub-modules — Products, Customers, Documents, Websites, Vendors, Tone of Voice — and collect defects in Issues Found. These are the structured + unstructured sources agents ground their answers on, so import correctness and RAG indexing matter as much as CRUD.

## Prerequisites

Bring the stack up per [FULL_SITE_TESTING.md](FULL_SITE_TESTING.md) and sign in as `admin@admin.test` / `Admin@123`. The knowledge tabs live under the **Base de connaissances / Knowledge** area (Documents · Websites · Products · Customers · Vendors).

> **AI Instructions**: Run each sub-module's block in order; one finding per defect with a screenshot. For imports, keep a small valid CSV/XLSX and a deliberately malformed one to hand.

## Screenshot Setup

```bash
mkdir -p tests/screenshots/$(date +%Y-%m-%d_%H_%M)/knowledge
```

## Products

| ID  | Test                     | Steps                                                    | Expected                                                                                            |
| --- | ------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| PR1 | List columns             | Open Products                                            | Table shows Name, Description, Stock, **Price, Category, Status**, Updated (#1310/#1356)            |
| PR2 | Create product           | Add product with name, price, currency, category, status | Created; price + category + status visible in the list                                              |
| PR3 | CSV/XLSX import (valid)  | Import a well-formed file                                | Rows imported; count reported                                                                       |
| PR4 | Import (header mismatch) | Import a file whose columns don't match                  | Fails loudly with a clear "missing required column" error — no silent partial import (#1310 family) |
| PR5 | Edit / delete            | Edit a product; delete it                                | Changes persist; deletion removes the row                                                           |

## Customers

| ID  | Test                        | Steps                                                 | Expected                                                        |
| --- | --------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| CU1 | Create / list               | Add a customer (email, name, locale)                  | Appears in the list                                             |
| CU2 | Import aliased headers      | Import CSV with `Email Address` / `Full Name` columns | Maps via aliases — name not dropped (#1312)                     |
| CU3 | Import missing email column | Import a file with no email-like column               | Rejected with a clear error; nothing partially imported (#1312) |
| CU4 | Dedup on import             | Import a file with a duplicate email                  | Duplicate handled (skipped/merged), not double-created          |

## Documents

| ID  | Test                     | Steps                                              | Expected                                                                   |
| --- | ------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------- |
| DO1 | Upload                   | Upload a PDF/DOCX                                  | "Uploaded — indexing in background" copy; row appears (#1460)              |
| DO2 | RAG indexing status      | Watch the document's status badge                  | Moves to indexed; on failure shows a Retry/error-detail affordance (#1459) |
| DO3 | Multi-team assignment    | Open a document's team dialog, assign 2 teams      | Multiple teams selectable + preserved on save (#1325)                      |
| DO4 | Upload into team folder  | Upload into a team-scoped folder                   | Team selector locked to the folder's team with a hint (#1469)              |
| DO5 | Long file name in dialog | Open the team dialog for a long no-space file name | Name wraps; dialog doesn't overflow (#1324)                                |
| DO6 | Unsupported type         | Upload a disallowed extension                      | Rejected with a clear message                                              |

## Websites

| ID  | Test                     | Steps                                  | Expected                                                |
| --- | ------------------------ | -------------------------------------- | ------------------------------------------------------- |
| WS1 | Add website              | Add a domain + scan interval (60m–30d) | Crawl scheduled; row shows next scan                    |
| WS2 | Domain read-only on edit | Edit an existing website               | Domain is read-only (by design); scan interval editable |
| WS3 | Rescan now               | Trigger an on-demand rescan            | Crawl runs; page count updates                          |

## Vendors

| ID  | Test                    | Steps                                    | Expected                                                  |
| --- | ----------------------- | ---------------------------------------- | --------------------------------------------------------- |
| VE1 | Create / list           | Add a vendor                             | Appears in the list                                       |
| VE2 | Bulk delete             | Select multiple vendor rows → delete     | Bulk-delete bar appears; rows removed in one action       |
| VE3 | Import (xlsx, mismatch) | Import an xlsx with non-matching columns | Loud error instead of dropping the name silently (#1323)  |
| VE4 | Import form copy        | Open the vendor import form              | Format hint renders real text, not a raw i18n key (#1412) |

## Tone of Voice

| ID  | Test          | Steps                                          | Expected                                       |
| --- | ------------- | ---------------------------------------------- | ---------------------------------------------- |
| TV1 | Edit tone     | Change the tone description + example messages | Saved; reflected when an agent drafts a reply  |
| TV2 | AI generation | Use the AI tone-generation helper              | Produces a draft tone the user can accept/edit |

## Accessibility & performance (all sub-modules)

| ID  | Check                     | Expected                                                    |
| --- | ------------------------- | ----------------------------------------------------------- |
| X1  | Tables keyboard-navigable | Sort, select, row actions reachable by keyboard             |
| X2  | Import dialogs labelled   | File inputs + team selectors have labels + focus management |
| X3  | Status not colour-only    | Indexing / stock status conveyed by text, not colour alone  |
| P1  | List load                 | Each list's first page < 1.5 s                              |
| P2  | Import feedback           | Progress + completion reported within the dialog            |

## Issues Found

| #   | Test ID | Page / URL | Severity | Description | Screenshot |
| --- | ------- | ---------- | -------- | ----------- | ---------- |
|     |         |            |          |             |            |

## Test summary

```
Module: Knowledge Base
Products: ___/5  Customers: ___/4  Documents: ___/6  Websites: ___/3  Vendors: ___/4  Tone: ___/2  A11y+Perf: ___/5
Issues found: ___ (crit __ / high __ / med __ / low __)
Status: PASS / FAIL
```
