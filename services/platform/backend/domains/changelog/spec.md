# Changelog — who can read the release notes, and how far back they go

> **Prefix** `CLOG-` · **Docs** [`admin/changelog`](../../../../../docs/en/platform/admin/changelog.md)

The release notes behind **What's new** are read from the product's public release list on
GitHub. These rules say who can read them, how far back the list goes, and what a reader gets
when GitHub cannot be reached. How long a page is kept before it is read again is not covered;
see Not yet.

## Who can read the release notes

### CLOG-R1 · Anyone who is signed in can read the release notes

No organization and no role is asked for. A request without a session is refused
(`UNAUTHORIZED`) and nothing is read.

- **Example**: Mia is a member with no admin role. She opens **What's new** → the release
  notes load.

## How far back the notes go

### CLOG-R2 · The notes go back to the reader's version, three pages at most

GitHub lists releases one page at a time, newest first. Pages are read until one reaches the
version the reader is on. A reader more than three pages behind gets the newest three pages
and finds the rest on GitHub. A reader who names no version gets the newest page.

- **Example**: Mia's deployment runs a version listed on the second page → she gets the first
  two pages, and the third is not read.

## When GitHub cannot be reached

### CLOG-R3 · When only older releases fail to load, the newer ones are still shown

- **Example**: The first page loads and the second does not → Mia sees the releases of the
  first page.

### CLOG-R4 · When no release can be loaded, the reader gets an error, not an empty list

The error has its own code (`CHANGELOG_UNAVAILABLE`), so the page can tell "nothing could be
loaded" from "you are up to date".

- **Example**: The deployment has no network access. Mia opens **What's new** → she is told
  the notes could not be loaded.

## Not yet

- **How long a page is kept**: a page read from GitHub is reused for an hour. No test holds it
  yet (`service.ts`).
- **How a release page is read from GitHub** (`core/changelog/internal_actions.ts`).
- **The unread indicator** of an update, and what clears it: kept by the app, not by this
  domain.
