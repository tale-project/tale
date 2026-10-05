# OneDrive — what a sync keeps in step, and who is told when it stops working

> **Prefix** `ODRIVE-`

A person who has connected their Microsoft account can import files from OneDrive and
SharePoint once, or keep a folder in sync: files added or changed in the folder are imported
again, and files removed from it are removed from Tale. These rules cover what a sync keeps
in step, what it never touches, what happens when the folder is gone, and who is told when a
sync keeps failing. The connection itself is in the cloud import spec; see Not yet.

## What a sync keeps in step

### ODRIVE-R1 · A sync removes a document whose file disappeared from the synced folder

Only documents the sync itself imported are removed.

- **Example**: A folder is kept in sync. Someone deletes `draft.docx` in OneDrive → at the
  next sync the document `draft.docx` is removed from Tale.

### ODRIVE-R2 · A sync never touches a document that someone uploaded or another sync owns

- **Example**: Mia uploads a file by hand into the folder a sync files into → the sync leaves
  her file alone, however the OneDrive folder changes.

### ODRIVE-R3 · A file that has not changed is not downloaded again

A file is unchanged when Microsoft's fingerprint of its content is the same. For a file
without one, its size and the time it was last changed are compared.

- **Example**: A sync runs every hour over a folder of 200 files, one of which changed → one
  file is downloaded.

### ODRIVE-R4 · Synced files keep their folders, under the place the sync files into

A subfolder of the synced folder becomes a subfolder under the destination, not beside it.

- **Example**: The OneDrive folder `Reports` with a subfolder `2026` is synced into the
  library folder `Finance` → the files land in `Finance/Reports` and `Finance/Reports/2026`.

## When the synced folder is gone

### ODRIVE-R5 · When the synced folder was deleted at the source, its documents are removed

A sync whose folder no longer exists, or sits in the provider's trash, removes the documents
it had imported and reports that the source was deleted. A folder that still exists and is
merely empty is treated as emptied: its documents are removed the usual way. A listing that
fails while the folder still exists removes nothing and fails the run.

- **Example**: Mia deletes the OneDrive folder a sync was following → at the next run the
  documents the sync had imported are removed, and the sync shows that its source is gone.

## When a sync is stopped

### ODRIVE-R6 · Stopping a sync also ends a run that is in progress

This holds when the sync is cancelled, when the folder it files into is deleted, and when a
file that was synced on its own is moved to the trash. A sync that is switched on again starts
clean.

- **Example**: A sync is half-way through a large folder when Mia cancels it → the run is
  recorded as cancelled, and the sync is off.

## Being told about a failing sync

### ODRIVE-R7 · The owner of a sync is told at once when its account must be reconnected

- **Example**: Mia's Microsoft access is withdrawn. Her sync runs → she gets a notification
  that the account must be reconnected.

### ODRIVE-R8 · A sync that keeps failing for another reason is reported after an hour

A failure that may pass, such as an outage at the provider, is not reported at first. Once
the sync has been failing for an hour, its owner is told, once. The same cause is not
reported again. When the failure turns into "the account must be reconnected", that is
reported at once.

- **Example**: Microsoft's service is down for ten minutes → Mia is told nothing. It is down
  for two hours → she is told once.

### ODRIVE-R9 · A sync that works again clears its failure notice

The first successful run after a failure marks the notice as read and refreshes the page that
shows the sync.

- **Example**: Mia reconnects her account and the next sync succeeds → the notification about
  the failing sync is cleared.

## Not yet

- **Connecting a Microsoft account, and renewing its access**: see the cloud import spec.
- **Browsing OneDrive and SharePoint**, the limits of a listing, and the request allowance
  per organization (`routes.ts`, `core/onedrive/list_files.ts`).
- **A one-time import**: which files it brings in, and what it does when the connection ends
  part-way. It follows the Google Drive spec's rules; its tests are not named here.
- **The size limit of one imported file**, and the words a refused file carries.
- **Two runs of one sync at the same time** (`service.ts`).
