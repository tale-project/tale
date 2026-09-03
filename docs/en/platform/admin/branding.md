---
title: Branding
description: Logo, favicon, and the accent colour your organisation shows to its members. Admins read this when whitelabelling a self-hosted instance or aligning the in-product chrome with the company palette.
---

Branding is the surface that swaps Tale's default chrome for your organisation's own. The page covers the assets the platform skins — logo, favicon, and the accent colour the palette derives from — and explains where each one shows up so you can preview before you save. The product name itself follows your organisation's name automatically, so there is no separate field to fill. Admins reach for branding when a self-hosted instance ships to an external audience or when an internal rollout needs to feel native to the company.

Only Admins and Owners can edit branding. Everyone else sees the result; the form itself is hidden from Editors, Developers, and Members.

<Frame caption="Settings > Branding — the logo, favicon, and colour controls beside a live preview of the sidebar.">

![The Branding settings page with logo and favicon uploads, an accent colour field, and a live preview pane on the right.](/images/platform/settings-branding.webp)

</Frame>

## Where branding lives

Open **Settings > Branding**. The form has three sections (logo upload, favicon upload, accent colour) and a live preview that mirrors the sidebar with the values you are editing. Save commits the change for every member of _that_ organisation on their next page load — there is no per-user override.

Branding is scoped to one organisation. Each organisation keeps its own logo, favicon, and accent colour, so switching organisations swaps the chrome to that organisation's branding rather than carrying the previous one's over. Editing here changes only the organisation you are currently in.

## The product name

There is no "app name" or "text logo" field. The wordmark in the sidebar header and the name in the browser tab title are your organisation's own name, which you set on the **Settings > Organization** page. Rename the organisation and the chrome follows on the next page load. Upload a logo image (below) and it takes the wordmark's place; with no logo, the organisation name is rendered as the text wordmark.

## The assets

**Logo** is an image — PNG, SVG, JPG, WebP, or ICO. The platform renders it at sidebar height; aim for a transparent background and a wordmark that reads at roughly 32 pixels tall. The logo is a single upload used on both themes, so pick a mark that reads on light and dark backgrounds. With no logo, the chrome falls back to your organisation's name as a text wordmark.

**Favicon** is the tab icon. Upload a light and a dark variant so the icon stays legible whichever theme the operating system has chosen — or leave it blank and Tale derives one from your logo the moment you upload it, so a single upload skins both the sidebar and the browser tab. An explicit favicon always wins over the auto-derived one.

**Accent colour** is the single colour the branded palette derives from — buttons, focus rings, selection states, and the sidebar's active row all take their tone from it. It accepts any hex value, picked once for both light and dark mode; Tale derives a legible palette per theme, so a colour that would be hard to read against one theme's background is nudged into contrast for that theme only while the other stays untouched — the same brand reads cleanly on both. The preview reflects the derived palette for the theme you are currently viewing.

## A worked rebrand

To rebrand an instance for `Acme Corp`, first set the organisation's name to `Acme Corp` on the **Settings > Organization** page — that name becomes the sidebar wordmark and the browser tab title. Then open **Settings > Branding**, upload the company wordmark as the logo, and paste the brand hex (`#3B82F6` for the example) into the accent colour field. Leave the favicon blank and Tale generates one from the logo. The preview pane on the right updates as you type. Save commits the change; the sidebar, the browser tab, and the favicon reflect the new branding immediately.

## The custom login screen

The sign-in, sign-up, and password-reset screens render before you have picked an organisation, so there is no organisation in scope to brand them with. They show the platform's default branding rather than any single organisation's; per-organisation branding takes over the moment you land inside that organisation's workspace. Sign out and reload the login URL to verify which assets the pre-auth screens use.

## Where this fits

Branding is the visual layer that sits above every other admin surface; SSO, email, and audit logs all carry the branded chrome to your members. Because the product name is the organisation's own name, keep it sharp on the [organization](/platform/admin/members-and-roles) settings. Pair branding with [providers](/platform/admin/providers) so the model names that show in the chat header match the chrome around them, and with [members and roles](/platform/admin/members-and-roles) so the people who can edit branding are the same people who own the rest of the org's chrome.
