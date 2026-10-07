# Products — what a product record and its image are held to

> **Prefix** `PROD-` · **Docs** [`knowledge/structured-data`](../../../../../docs/en/platform/knowledge/structured-data.md)

A product is a record of something the organization sells: a name, a price, a status, an
image. These rules cover what a product's fields accept, what an edit and an import do, who
can see a product image, and what deleting a product does to its image. Listing and searching
products and the REST API are not covered; see Not yet.

## What a product accepts

### PROD-R1 · A product's status is one of the statuses the product list knows

Any other value is refused (`PRODUCT_STATUS_INVALID`), on creation and on edit, and nothing is
saved. Upper and lower case count: a known status in capitals is refused too.

- **Example**: An import sets a product's status to `bogus` → that product is refused.

### PROD-R2 · Two products of one organization cannot share an external ID

The external ID is the key a product has in another system, such as its SKU. A second product
with the same one is refused (`DUPLICATE_PRODUCT_EXTERNAL_ID`), on creation and on edit.

- **Example**: A product with the external ID `sku-2` exists. Noah gives another product the
  same ID → refused.

### PROD-R3 · A currency is a three-letter code of a real currency

Upper and lower case both work (`USD`, `usd`). A code that names no currency is refused.

- **Example**: Noah saves a price in `ZZZ` → refused.

## Importing a file

### PROD-R4 · An import file holds at most 1,000 rows

A file with one row more is refused as a whole, with a message that names the limit.

- **Example**: Noah uploads a file of 1,001 products → refused, and none is imported.

### PROD-R5 · A row that cannot be imported is refused alone; the rest is imported

The answer names the row and the column of each refused row, counted the way the file had
them.

- **Example**: Noah imports three products, and the second has `free` as its price → products
  one and three are imported, and the answer names row two and its price.

## Editing a product

### PROD-R6 · An edit changes only the fields it sends, and an empty field is cleared

Every field the edit does not send keeps its value; the status can be cleared like any other
optional field. For the free-form data on a product, keys the edit sends are set, keys it
leaves out stay, and a key sent as empty is removed.

- **Example**: Noah clears a product's description and saves → the description is removed, and
  the name and price are as they were.

### PROD-R7 · An edit made from an outdated copy of the product is refused

An edit can say which version of the product it started from. When someone else saved in
between, it is refused (`PRODUCT_STALE`).

- **Example**: Mia and Noah open the same product. Noah saves a new price. Mia then saves from
  the form she opened earlier → refused, and Noah's price stays.

### PROD-R8 · An edit that changes nothing writes nothing

No audit entry is written and nobody's list is refreshed.

- **Example**: Noah opens a product and saves it unchanged → the audit log gains no entry.

## Product images

### PROD-R9 · Uploading a product image needs a role that can edit products

Anyone else is refused (`RBAC_FORBIDDEN`) before anything is stored.

- **Example**: Mia's role cannot edit products. She uploads an image → refused.

### PROD-R10 · A product image is a real image of at most 5 MB

An empty file, a larger one, and a file that is not an image are refused
(`PRODUCT_IMAGE_INVALID`). The type is read from the file's content, not from its name. An
SVG that could run script is refused under its own code (`PRODUCT_IMAGE_ACTIVE_CONTENT`); a
plain SVG is accepted.

- **Example**: Noah uploads an SVG that contains a script → refused, with a message that says
  the drawing carries active content.

### PROD-R11 · A product image is shown only while a product of the organization uses it

The person who uploaded an image can preview it before any product uses it. For everyone else
the image must be the image of a product in their own organization, or it is answered as not
found (`PRODUCT_IMAGE_NOT_FOUND`). An address made up to point at another organization's
image gets the same answer.

- **Example**: Zoe, in another organization, opens the address of one of Noah's product images
  → not found.

## Deleting a product

### PROD-R12 · Deleting a product deletes its uploaded image, unless something else uses it

The image goes with the product, and likewise when an edit replaces or removes it. It is kept
when another product shows the same upload, or when a task, a document or a kept version
still uses the same file. An image that is only a link to another site is never touched.

- **Example**: Two products show the same uploaded picture. Noah deletes one → the picture
  stays for the other.

### PROD-R13 · A product under a legal hold cannot be deleted

While the organization is under a legal hold, or the person who uploaded the product's image
is, the delete is refused (`LEGAL_HOLD_ACTIVE`) and nothing is removed.

- **Example**: The organization is under a legal hold. Noah deletes a product → refused, and
  the product and its image stay.

## Not yet

- **Listing, counting and searching products**, and the limits of a page (`routes.ts`).
- **Who can read a product**, and which roles can edit one (`PROD-R9`): set by the permission
  table.
- **Products over the REST API** (`rest/v1-core.ts`, `rest/product-images.ts`).
- **Limits on the length of a product's text fields** (`core/products/field_limits.ts`).
