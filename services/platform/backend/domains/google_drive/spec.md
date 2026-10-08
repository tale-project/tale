# Google Drive — what an import from Drive brings in, and what it leaves alone

> **Prefix** `GDRIVE-`

A person who has connected their Google account can browse their Drive, import files from it
once, or keep a folder in sync. These rules cover which files an import brings in, where they
are filed, what a repeated import does, and what happens when the connection ends in the
middle. The connection itself is in the cloud import spec; see Not yet.

## What is imported

### GDRIVE-R1 · An import brings in the files that were picked, and the files of picked folders

Picking a folder imports what is in it. A file that was neither picked nor in a picked folder
is not imported.

- **Example**: Mia picks the folder `Contracts` and one file from another folder → the files
  in `Contracts` and that one file are imported, and nothing else.

### GDRIVE-R2 · A file in the Drive trash is not imported

To an import it does not exist.

- **Example**: A file Mia picked last week is in the Drive trash by the time the sync runs →
  the sync finds no such file.

### GDRIVE-R3 · A file that has not changed is not downloaded again

A file is unchanged when Drive's fingerprint of its content is the same. For a file Drive
gives no fingerprint for, its size and the time it was last changed are compared, and the file
is downloaded again when either moved or is unknown. Running the same selection again skips
the files already imported.

- **Example**: Mia imports the same folder twice → the second import downloads only the files
  that changed in between.

## Where imported files are filed

### GDRIVE-R4 · Imported files keep their folders, under the place the import was aimed at

A file picked without a folder goes into the chosen destination, and into the top level when
none was chosen. A subfolder in Drive becomes a subfolder under the destination, not beside
it.

- **Example**: Mia imports the Drive folder `2026/Q1` into the library folder `Finance` → the
  files land in `Finance/2026/Q1`.

### GDRIVE-R5 · A synced document stays synced when a one-time import touches it

A document a sync owns keeps belonging to that sync when a one-time import brings in a newer
version of the same file. An unchanged document from an earlier one-time import is taken over
by a sync that covers it, and moved into the sync's folder. A one-time import never moves a
document.

- **Example**: A folder is kept in sync. Mia imports one of its files again by hand → the
  document is updated and is still updated by the sync afterwards.

## When the connection ends

### GDRIVE-R6 · An import stops at the file where its connection ended, and keeps the rest

The files imported before that point stay imported, and the answer says that the account must
be reconnected. When the connection is already gone at the start, the answer names every file
that was asked for as not imported. When Drive refuses the access and it can be renewed, the
import carries on.

- **Example**: Mia's access is withdrawn while her import is at the third of five files → two
  files are imported, and she is asked to reconnect for the other three.

### GDRIVE-R7 · Listing a large folder stops at a limit and says the list is incomplete

A search is cut off sooner than a folder listing. A list that ends exactly at the limit is
complete.

- **Example**: Mia opens a Drive folder with tens of thousands of files → she gets the first
  part, with a note that the list is not complete.

## Request limits

### GDRIVE-R8 · Browsing and importing each have a request allowance per organization

Listing a folder and importing files are counted separately. Once an allowance is used up,
further requests of that kind are refused (`RATE_LIMITED`) with the time after which to try
again.

- **Example**: The organization's allowance for imports is used up → Mia's import is refused,
  with the seconds to wait, and she can still browse her Drive.

## Not yet

- **Connecting a Google account, and renewing its access**: see the cloud import spec.
- **Google Docs, Sheets and Slides**, which have no file to download: how they are offered and
  imported (`core/google_drive/list_files.ts`).
- **The size limit of one imported file**, and the limits behind `GDRIVE-R7` and `GDRIVE-R8`.
- **Who can browse and import**: any member with a connected account. No test holds it yet
  (`routes.ts`).
