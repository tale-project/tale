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

## Create a contact

You need an Editor role or higher to maintain organization records. Open **Knowledge > Contacts**, choose **Add contact**, then **Manual entry**.

1. Enter the contact’s **Email**. Add a **Name** and **Phone** if useful.
2. Check **Locale**, which starts as `en`, and set the language appropriate to the contact.
3. Choose **Save**. The new row appears in Contacts with its details and added date.

You can also add a contact while writing to them. In the **Inbox** view in Home, choose **New email** and type an address into **To**: if no contact carries it, the list offers **Add “…” as a contact**, which opens this same form with the **Email** already filled. Saving makes that contact the recipient, so you never leave the message you are writing.

If the email address already exists, find the existing contact and update it through the row menu instead of creating a duplicate; from **New email**, Tale selects the existing contact for you. Saving a contact creates a record; it does not send that person an email.

## Create a product

Open **Knowledge > Products**, choose **Add product**, then **Manual entry**. The form has three stages.

1. Under **Basics**, enter a **Product name**. Add a description and image if they help someone identify the product, then choose **Next**.
2. Under **Pricing & inventory**, set **Price** and **Currency** together. For example, enter `12.50` and select `CHF`; changing the currency does not convert the amount. Add stock and category when relevant, and check **Status**. A new product starts as **Draft**.
3. Under **Review**, check the details and choose **Create**. The product appears in the table with its price, status, and updated date.

Use the row menu to edit a saved product. Keep product names distinct so teammates can identify the right record, and review the price and currency before changing its status.

To add a product image, choose **Upload image** or drop a PNG, JPEG, WebP, GIF, or SVG file into the image area. The limit is 5 MiB. Wait for the preview before moving on; if the upload fails, check the format and size, then try again. Tale checks the uploaded bytes and refuses active SVG content.

The uploaded image stays available after you save and reload the product. Other organization members with product access can view it once the product is saved; the image address requires a signed-in session and is not a public sharing link. To remove it, edit the product, choose **Remove image**, then save.

If you choose **Or paste a URL**, use a public HTTPS address. Tale refuses unsafe or disallowed hosts; ask an administrator if you need an internal image source. Images loaded from external addresses follow that source’s access rules.

## Keep access and freshness in view

A record or document is useful only to people who can access it. Check its team scope when a teammate cannot find it. Project files follow project access rather than the document library’s team tags; see [Project files](/platform/projects/manage-files).

Update the authoritative record when a detail changes. For a revised document, wait until indexing finishes before testing a question against its new text. Website content follows its configured scan interval, so it may lag behind the live page.

## Work with the available record types

The Knowledge area provides Contacts, Products, and Websites. **Settings > Governance > Models** controls AI model access and defaults; it does not create custom record types or database fields.

If the available fields do not fit your material, keep the detail in a document and link the surrounding process to the appropriate record. For programmatic imports and the fields each resource accepts, use the [API reference](/develop/api-reference).

Read [Documents](/platform/knowledge/documents) to upload and verify a file, [Knowledge entries](/platform/knowledge/knowledge-entries) to maintain one fact, or [Crawling](/platform/knowledge/crawling) to keep public pages searchable.
