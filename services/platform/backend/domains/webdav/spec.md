# WebDAV — who can create an app password, and what revoking one does

> **Prefix** `WEBDAV-` · **Docs** [`connectors/webdav`](../../../../../docs/en/platform/connectors/webdav.md)

With WebDAV a person mounts their organization's documents as a network drive. The drive
signs in with an app password made for one device. These rules cover who can create an app
password, what is kept of it, and what revoking one does. What the mounted drive can read and
change is not covered; see Not yet.

## App passwords

### WEBDAV-R1 · Only owners, admins and developers can create an app password

Any other member is refused, and nothing is created.

- **Example**: Mia is a member. She generates an app password for her laptop → refused.

### WEBDAV-R2 · An app password is shown once, and only its first characters are kept on record

The audit log records that a password was created, with its label and its first characters,
never the password. A label is 1 to 64 characters; a request without a valid label is refused
with a message that names what is wrong.

- **Example**: Noah generates an app password labelled `MacBook` → he sees the password once,
  and the list afterwards shows `MacBook` with the password's first characters.

### WEBDAV-R3 · A person can revoke only their own app passwords

A password that belongs to someone else, or to another organization, is answered as not found,
and nothing is recorded.

- **Example**: Ada, an admin, revokes Noah's app password by its ID → not found.

### WEBDAV-R4 · Revoking an app password frees what the device had locked

The password is marked as revoked, the file locks its device was holding are released, and
the revocation is written to the audit log, all together. Revoking a password that is already
revoked changes nothing.

- **Example**: Noah's laptop had a document locked for editing when he revokes its password →
  the document is unlocked, and the laptop can no longer sign in.

## Not yet

- **What a mounted drive can read and change**: which documents and folders it shows, and how
  a copy, a move or a delete there acts on documents (`handlers.ts`).
- **Signing in with an app password**, and the refusal after too many wrong attempts.
- **File locks**: how long one lasts and who can break it.
