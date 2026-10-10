# Branding — what an organization's logo, icons and accent color guarantee

> **Prefix** `BRAND-` · **Docs** [`admin/branding`](../../../../../docs/en/platform/admin/branding.md)

An organization can carry its own logo, browser-tab icons and accent color. These rules cover
who can change the branding, what can be uploaded as an image and what a save records. Who can
read it is not covered; see Not yet.

## Who can change it

### BRAND-R5 · Only owners and admins can change the branding

Reading the stored branding for editing, saving it and uploading or deleting its images take the
owner or admin role. Anyone else is refused (`ORG_FORBIDDEN`) with the sentence naming the
capability their role lacks, before anything is read or saved.

- **Example**: Noah is a developer. He saves a new accent color → refused, and the branding stays
  as it was; Ada, an admin, saves the same color → it is saved.

## What can be uploaded

### BRAND-R1 · An SVG that could run script is refused as a logo or icon

An SVG with a script element, an event handler such as `onload`, or a `javascript:` link is
refused (`IMAGE_SVG_ACTIVE_CONTENT`); nothing is stored and nothing is written to the audit
log. An ordinary export from a drawing tool is accepted. Images of other types are not
searched for such content.

- **Example**: Ada uploads an SVG logo that contains a script → refused, and the organization
  keeps the logo it had.

## Saving the branding

### BRAND-R2 · An uploaded image is part of the branding at once, and gone when deleted

Uploading a logo or an icon makes it the organization's without a further save. Deleting it
removes it from the branding in the same step.

- **Example**: Ada uploads a logo → the organization's branding names it. She deletes it →
  the branding names no logo.

### BRAND-R3 · A save made from an outdated copy of the branding is refused

A save says which version of the branding it started from. When someone else saved in
between, it is refused (`CONFIG_VERSION_CONFLICT`); the branding and the audit log stay as the
other person left them.

- **Example**: Ada and Noah, both admins, open **Branding**. Noah saves a new accent color.
  Ada then saves from the page she opened earlier → refused, and Noah's color stays.

### BRAND-R4 · A save writes one audit entry naming what changed, and none for no change

The entry lists the fields that were added, removed or changed.

- **Example**: Ada changes the accent color and saves → one audit entry that names the accent
  color. She saves again without changing anything → no entry.

## Not yet

- **Who can read the branding**: it is readable without signing in, because the sign-in page
  shows it. No test holds it yet (`routes.ts`).
- **Limits on an image's size and type**, and the icon derived from a logo when none is
  uploaded (`service.ts`, `core/branding/file_utils.ts`).
- **Reset**, which deletes the images and clears the accent color.
