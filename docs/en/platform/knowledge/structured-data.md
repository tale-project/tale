---
title: Choose documents or structured records
description: Decide where to keep policies, contact details, product data, and website content so Tale can find the right information.
---

Use documents for information that needs paragraphs to explain, such as a contract or a meeting note. Use structured records for information that belongs in named fields, such as a contact’s email address or a product’s identifier. Most teams need both: the record identifies the thing, and the documents explain its history or context.

## Choose a home for the information

| Information | Put it in | Why |
| --- | --- | --- |
| A policy, contract, manual, or meeting note | **Documents** | Tale searches the text and retrieves relevant passages. |
| A short fact that needs its own update history | **Knowledge entries** | One topic has one current version, with earlier versions retained. |
| A person or organization you work with | **Contacts** | Named fields keep details together in a record you can update. |
| A product and its attributes | **Products** | Product details stay in fields instead of being buried in a file. |
| Pages on a public website | **Websites** | Tale crawls the pages and updates their searchable content on a schedule. |
| Reference files for one project | The project’s **Knowledge** tab | Access follows the project, and project chats can retrieve the files. |

The way information is stored affects how it is retrieved. Finding a passage in a document does not establish that the whole file was reviewed. Reading a record’s fields gives Tale those values; it does not guarantee that the source is current or that an answer based on it is correct.

## Combine records with supporting documents

Suppose you need to prepare for a call with Acme. Keep its contact details in **Contacts** and its contract and meeting notes in **Documents**, or in the relevant project’s **Knowledge** tab.

Ask the chat assistant to find Acme’s contact record and summarize the open questions from the latest notes. Check the record for the email address and the cited notes for the decisions. If the files belong to a project, start the chat inside that project so it can reach them.

<Tip>

Use the same recognizable company or product name in record titles and supporting files. Add dates to meeting notes and revision identifiers to policies so you can distinguish a current source from an old one.

</Tip>

## Keep access and freshness in view

A record or document is useful only to people who can access it. Check its team scope when a teammate cannot find it. Project files follow project access rather than the document library’s team tags; see [Project files](/platform/projects/manage-files).

Update the authoritative record when a detail changes. For a revised document, wait until indexing finishes before testing a question against its new text. Website content follows its configured scan interval, so it may lag behind the live page.

## Work with the available record types

The Knowledge area provides Contacts, Products, and Websites. **Settings > Governance > Models** controls AI model access and defaults; it does not create custom record types or database fields.

If the available fields do not fit your material, keep the detail in a document and link the surrounding process to the appropriate record. For programmatic imports and the fields each resource accepts, use the [API reference](/develop/api-reference).

Read [Documents](/platform/knowledge/documents) to upload and verify a file, [Knowledge entries](/platform/knowledge/knowledge-entries) to maintain one fact, or [Crawling](/platform/knowledge/crawling) to keep public pages searchable.
