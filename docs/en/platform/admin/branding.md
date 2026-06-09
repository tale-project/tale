---
title: Branding
description: Logo, favicon, app name, and brand colours your organisation shows to its members. Admins read this when whitelabelling a self-hosted instance or aligning the in-product chrome with the company palette.
---

Branding is the surface that swaps Tale's default chrome for your organisation's own. The page covers the four assets the platform skins — app name, logo, favicon, brand and accent colours — and explains where each one shows up so you can preview before you save. Admins reach for branding when a self-hosted instance ships to an external audience or when an internal rollout needs to feel native to the company.

Only Admins and Owners can edit branding. Everyone else sees the result; the form itself is hidden from Editors, Developers, and Members.

## Where branding lives

Open **Settings > Branding**. The form has four sections (app name and text logo, logo upload, favicon upload, colours) and a live preview that mirrors the sidebar with the values you are editing. Save commits the change for every member of _that_ organisation on their next page load — there is no per-user override.

Branding is scoped to one organisation. Each organisation keeps its own logo, favicon, app name, and colours, so switching organisations swaps the chrome to that organisation's branding rather than carrying the previous one's over. Editing here changes only the organisation you are currently in.

## The four assets

**App name** replaces the word `Tale` in the sidebar header, the browser tab title, and outbound emails. Pick a short string that reads the way your organisation refers to the tool internally.

**Text logo** is an optional shorter form used in tight spots — the collapsed sidebar, the favicon-adjacent header. Leave it blank to fall back to the first letters of the app name.

**Logo** is an image — PNG, SVG, or JPG. The platform renders it at sidebar height; aim for a transparent background and a wordmark that reads at roughly 32 pixels tall. Upload a light variant and the dark variant separately if your wordmark needs to invert on dark theme.

**Favicon** is the 64 by 64 pixel tab icon. Upload a light and a dark variant so the icon stays legible whichever theme the operating system has chosen for the browser chrome.

**Brand colour** is the primary accent — buttons, focus rings, the sidebar's active row. **Accent colour** is the secondary tone used for hover and selection states. Both accept any hex value; the preview shows the contrast against light and dark backgrounds.

## A worked rebrand

To rebrand an instance for `Acme Corp`, open **Settings > Branding** and fill the form top-down. Set the app name to `Acme AI`, upload the company wordmark as the logo (light and dark variants), upload the square Acme mark as the favicon, and paste the brand hex (`#3B82F6` for the example) into the brand colour field. The preview pane on the right updates as you type. Save commits the change; the sidebar, the browser tab, and the next outbound email reflect the new branding immediately.

## The custom login screen

The sign-in, sign-up, and password-reset screens render before you have picked an organisation, so there is no organisation in scope to brand them with. They show the platform's default branding rather than any single organisation's; per-organisation branding takes over the moment you land inside that organisation's workspace. Sign out and reload the login URL to verify which assets the pre-auth screens use.

## Where this fits

Branding is the visual layer that sits above every other admin surface; SSO, email, and audit logs all carry the branded chrome to your members. Pair it with [providers](/platform/admin/providers) so the model names that show in the chat header match the chrome around them, and with [members and roles](/platform/admin/members-and-roles) so the people who can edit branding are the same people who own the rest of the org's chrome.
