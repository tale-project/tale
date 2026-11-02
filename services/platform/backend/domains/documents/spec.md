# Documents — who can change a document, and what protects a reviewed one

> **Prefix** `DOC-` · **Docs** [`knowledge/documents`](../../../../../docs/en/platform/knowledge/documents.md)

A document is a file or a text in the organization's library or in a project. Some documents
are kept as records: they go through a review, and an approved version cannot be changed or
deleted. These rules cover who can change documents, what a review requires, what protects a
record, moving a document between folders, what an edit and a delete do, and the list of a
person's files that count toward their storage limit. Reading, listing and searching
documents otherwise, and replacing a document's file, are not covered; see Not yet.

## Who can change documents

### DOC-R1 · Only owners, admins, developers and editors can change library documents

A member is refused (`RBAC_FORBIDDEN`), and so is a seat that is disabled or carries a role
the platform does not know. Members can read.

- **Example**: Mia is a member. She renames a document in the library → refused.

## Reviews and records

### DOC-R2 · Nobody can review their own document

The person who sends a document for review cannot name themselves as its reviewer
(`REVIEWER_SELF_NOT_ALLOWED`), and cannot approve it even when an older request named them
(`REVIEW_SELF_APPROVAL_FORBIDDEN`).

- **Example**: Noah sends a procedure for review and picks himself as the reviewer → refused.

### DOC-R3 · Only the reviewer a review names can answer it

Anyone else is refused (`REVIEW_NOT_ASSIGNED`). A review that names no reviewer can be
answered by nobody.

- **Example**: A procedure waits for Ada's review. Mia approves it → refused.

### DOC-R4 · Sending a document for review again changes the reviewer, or changes nothing

While a review is waiting, sending the document again to the same reviewer keeps that review.
Naming another reviewer hands the review to them.

- **Example**: A document waits for Ada's review. Noah sends it again and names Mia → the
  review is now Mia's.

### DOC-R5 · A record's content cannot be changed while it is in review or approved

Its content is frozen from the moment it goes into review (`DOCUMENT_RECORD_FROZEN`). While a
record is still a draft, its content changes only by uploading a replacement file, not by
editing it in place (`DOCUMENT_RECORD_REPLACEMENT_REQUIRED`). A document that is not kept as
a record can be changed freely.

- **Example**: An approved procedure is opened and its text edited → the save is refused. A
  new revision is started instead.

### DOC-R6 · A record in review, approved or with an approved version cannot be deleted

The delete is refused (`DOCUMENT_RECORD_PROTECTED`). A first draft that was never approved
can be deleted. A draft of a new revision cannot, because the approved versions behind it
would go with it.

- **Example**: Noah deletes a procedure whose second revision is still a draft, and whose
  first was approved → refused.

## Moving a document

### DOC-R7 · A document can be moved only into a folder the person can see

A folder restricted to teams the person is not in is refused (`FOLDER_NOT_ACCESSIBLE`). An
admin can file into any folder. A document can always be moved back to the top level.

- **Example**: Noah, an editor in Legal, moves a document into a folder restricted to Finance
  → refused.

### DOC-R8 · A document moved into a team's folder becomes that team's

It takes the teams of the folder it is moved into, also when it belonged to another team
before. Moved into a folder that is open to the organization, it keeps the teams it had.

- **Example**: A document open to everyone is moved into the Finance folder → from then on
  only Finance and the admins see it.

## Editing and deleting

### DOC-R9 · An edit that changes nothing writes nothing

No version is added, nothing is indexed again and nobody's list is refreshed. For the
free-form data on a document, keys the edit sends are set, keys it leaves out stay, and a key
sent as empty is removed.

- **Example**: An integration sends a document the title it already has → nothing is written.

### DOC-R10 · An uploaded file becomes one document, in the library or in one project

The same upload cannot be turned into a document in the library and in a project, or in two
projects (`UPLOAD_SCOPE_CONFLICT`). Creating the same document again in the same place is
fine and yields the one document.

- **Example**: A file is uploaded and filed in the project Billing. A second request files the
  same upload in the library → refused.

### DOC-R13 · An upload is filed only in a folder of the place it was uploaded to

A file uploaded to a project goes into one of that project's folders, or to its top level when
no folder is named. A folder of another project, of the library or of another organization is
answered as not found (`FOLDER_NOT_FOUND`), and no document is created. A file uploaded to the
library cannot be filed in a project's folder either.

- **Example**: Noah uploads a file to the project Payroll into a folder of the project Billing
  → refused, the folder is not found, and no document is created.

### DOC-R11 · A delete is recorded only once the document is really gone

When removing the document's content could not be completed, the delete is answered as
incomplete (`PURGE_INCOMPLETE`), and no audit entry claims a deletion. In an archived project
a document can be neither deleted nor taken out of the project (`PROJECT_ARCHIVED`).

- **Example**: The file store fails while Ada deletes a document for good → she is told the
  delete is incomplete, and the audit log has no entry saying the document was deleted.

### DOC-R12 · Retry indexing also lifts an earlier choice not to index

A document whose uploader chose not to index it is indexed after an explicit retry. A
document of a kind that cannot be read, and one that is being indexed already, are answered
with a sentence that says so, and nothing is queued.

- **Example**: Mia uploaded a file with indexing off and later selects **Retry indexing** →
  the file is queued for indexing.

## What counts toward the storage limit

### DOC-R14 · The storage list holds exactly the files the storage limit counts

**Settings › Usage › Storage** lists, largest first, every file a person uploaded to the
organization: the files the upload limit counts and the meter adds up, whatever holds them
now, those in Trash too. Each file is named by the part of the meter it counts in. Where it
lives is named and linked only as far as the person may open it: a library document their
teams can see, a project they may read, their own chat. A file another person uploaded, or one
uploaded to another organization, is never listed. A document's title and state travel with a
file only where its place is open to the person, and Delete is offered as Knowledge and the
project's Files offer it, on the document's current file alone.

- **Example**: Ada uploaded a 9 MB report to a project she can no longer read and a 2 MB image
  in one of her chats → her list shows the report first, in a project it does not name, then
  the image in her chat, and the two add up to what her meter counts for them.

## Not yet

- **Reading, listing and searching documents**, and who can see a document restricted to
  teams (`service.ts`, `core/documents/access.ts`).
- **Replacing a document's file**: the check that the new file is of the kind it claims, and
  what happens to the earlier version (`replacement.ts`).
- **The states of a record and its versions**, and who can start a revision (`records.ts`).
- **Documents an agent writes**, and the text documents a project keeps for its instructions
  (`agent-write.ts`, `project-text.ts`).
- **The trash**: restoring a deleted document, and how long it stays.
- **Project documents**: they follow who can change the project; see the projects spec.
