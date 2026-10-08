# Folders — who can create and rename a folder, and what a folder name can be

> **Prefix** `FOLDER-` · **Docs** [`knowledge/documents`](../../../../../docs/en/platform/knowledge/documents.md)

Documents are filed in folders: the organization's library has a folder tree, and each project
has its own. A folder can be restricted to teams. These rules cover who can create, rename and
file into a folder, what a name can be, and what happens when two people create the same
folder. Moving and deleting folders are not covered; see Not yet.

## Who can change folders

| | Create or rename a library folder | Create or rename a project folder |
| --- | --- | --- |
| An owner, admin, developer or editor | yes, in the teams they can file into | when they can change the project |
| A member | no | no |

### FOLDER-R1 · Only owners, admins, developers and editors can change library folders

A member is refused (`RBAC_FORBIDDEN`), and so is a seat that is disabled or carries a role the
platform does not know. Nothing is written.

- **Example**: Mia is a member. She creates a folder in the library → refused.

### FOLDER-R2 · A folder of another organization is answered as not found

This holds whatever the caller's role, for the folder itself (`FOLDER_NOT_FOUND`) and for a
folder named as the parent of a new one (`FOLDER_PARENT_NOT_FOUND`).

- **Example**: Zoe, an editor in another organization, renames one of Ada's folders by its ID
  → not found.

### FOLDER-R3 · A team folder is out of reach for anyone outside its teams

Someone who is not in one of the folder's teams cannot rename it, file into it or create a
folder under it, even with a role that could otherwise (`FOLDER_NOT_ACCESSIBLE`,
`FOLDER_ACCESS_DENIED`, `FOLDER_PARENT_NOT_ACCESSIBLE`).

- **Example**: A folder is restricted to the Finance team. Noah, an editor in Legal, creates a
  subfolder in it → refused.

### FOLDER-R4 · An editor can restrict a folder only to teams they belong to

Naming a team they are not in is refused (`FOLDER_TEAM_FORBIDDEN`).

- **Example**: Noah is in Legal. He creates a folder restricted to Finance → refused.

### FOLDER-R5 · A project's folders follow who can change the project

A member is refused (`RBAC_FORBIDDEN`), and someone who cannot reach the project is refused
with the project's own answer (`PROJECT_FORBIDDEN`). An editor of the project can create and
rename its folders. A project folder cannot be given teams of its own
(`FOLDER_SCOPE_CONFLICT`): the project decides who sees it. In an archived project every
folder change is refused (`PROJECT_ARCHIVED`).

- **Example**: The project Billing was archived. Noah, one of its editors, creates a folder in
  it → refused, with the answer that says to restore the project first.

## Folder names

### FOLDER-R6 · A folder name is 1 to 128 characters, with no slash and no control character

Spaces around the name are dropped, and an accented letter counts as one character however it
was typed. A name that is blank, longer than 128, contains `/` or `\` or a control character,
or is `.` or `..` is refused (`FOLDER_NAME_INVALID`), and the refusal names the rule it broke.

- **Example**: Noah names a folder `2026/Q1` → refused, with the message that a folder name
  must not contain a path separator.

### FOLDER-R7 · Two folders in the same place cannot differ only in upper and lower case

Creating a folder that already exists under another spelling answers the existing one, with
the spelling it has. Renaming a folder to a name its neighbour has is refused
(`FOLDER_NAME_TAKEN`).

- **Example**: A folder `Invoices` exists. A sync creates `invoices` in the same place → it
  gets the existing `Invoices`, and no second folder appears.

### FOLDER-R8 · Two people creating the same folder at once end up with one folder

Whoever comes second gets the folder the first one created.

- **Example**: Two imports create the folder `Contracts` at the same moment → one folder
  exists, and both imports file into it.

## Not yet

- **Moving and deleting a folder**, and what happens to the documents in it (`service.ts`).
- **Who can see a folder** and the listing of a folder tree (`routes.ts`).
- **Folder names saved before names were normalized**: an older name can still sit beside its
  normalized twin; the contract debt ledger in
  [`.agents/repo.md`](../../../../../.agents/repo.md) records it.
