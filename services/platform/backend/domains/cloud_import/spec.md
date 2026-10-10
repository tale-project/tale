# Cloud import — what keeps a connection to a cloud drive working, and when it must be reconnected

> **Prefix** `CIMP-`

A person can connect their Microsoft or Google account so that files are imported from
OneDrive, SharePoint or Google Drive. The connection holds an access that the provider lets
Tale renew. These rules cover when a connection is marked as needing to be reconnected, what
a long import does when its access runs out, and when a file is not imported again. What each
drive's import and sync do is in the OneDrive and Google Drive specs; see Not yet.

## When a connection needs reconnecting

### CIMP-R1 · A connection the provider no longer honours is marked as needing reconnection

This is the case when the provider answers a renewal with a refusal of the connection itself,
or asks the person to sign in or consent again. The person is told to reconnect.

- **Example**: Mia removes Tale's access in her Microsoft account settings. The next import
  runs → her connection is marked as needing reconnection.

### CIMP-R2 · A provider outage never marks a connection as needing reconnection

When the provider is unreachable, throttles the request or answers with a server error, the
connection stays active and the failure is reported as one to try again. A mistake in the
deployment's own app registration is treated the same way, because reconnecting cannot fix it.

- **Example**: Google's sign-in service answers with a server error during a renewal → Mia's
  connection stays active, and the import can be retried later.

### CIMP-R3 · A renewal that arrives after the connection was revoked is thrown away

- **Example**: Mia disconnects her account while a renewal is in flight → the renewed access
  is not stored, and the connection stays revoked.

### CIMP-R4 · Stored access that cannot be read is reported with its cause

When the deployment's encryption key was changed and the stored access can no longer be
decrypted, the connection is flagged and the message names the key. Stored access that is
damaged is reported as unreadable, without blaming the key.

- **Example**: An operator replaces the encryption key without migrating → the next import
  says that the stored access cannot be read with the current key.

## During an import

### CIMP-R5 · A long import renews its access as it goes, and continues

The access is read again before each file. When the provider refuses the access in the middle
of an import, it is renewed once and that file is tried again. A renewal that is unavailable
for the moment does not stop the import: it carries on with the access it has.

- **Example**: An import of 500 files outlasts the hour its access is valid for → the access
  is renewed part-way through, and the remaining files are imported.

### CIMP-R6 · An import ends with a clear message once its connection needs reconnecting

It stops at the file it had reached, and says that the account must be reconnected.

- **Example**: Mia's access is withdrawn while her import is at file 40 → the import stops
  there, and the message asks her to reconnect.

### CIMP-R7 · A file that has not changed at its source is not imported again

A file counts as unchanged when the provider's fingerprint of its content is the same. When
the provider sends none, its size and the time it was last changed are compared, and only
when both are known.

- **Example**: A folder is synced again and one file in it is untouched since the last sync →
  that file is skipped.

## Not yet

- **OneDrive, SharePoint and Google Drive themselves**: listing, picking, importing and
  syncing files (the `onedrive` and `google_drive` domains).
- **Connecting and disconnecting an account**, and who can (`routes.ts`).
- **Which app registration a deployment uses** for the connection
  (`core/cloud_import/deployment_config.ts`).
