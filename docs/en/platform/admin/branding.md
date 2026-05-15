---
title: Branding
description: Customise the app name, logo, favicon, and brand colours so the running app reads as your organisation rather than as Tale.
---

Branding is the cosmetic layer on top of Tale. It replaces the word "Tale" in the browser tab and the header with your organisation's name, swaps in your logo and favicon, and picks the two colours used for buttons and highlights throughout the app. The audience is Admins — every other role's button is hidden — and the use case is reducing the number of moments where a member opens Tale and sees a name that is not their own. Changes apply organisation-wide the moment they are saved; no client reload is required.

Branding does not change what the product does or what models are available. For that, look at [AI providers](/platform/admin/providers) and [Governance](/platform/admin/governance) instead.

## Available options

The form lives at **Settings > Branding** and exposes one screen of options.

| Option           | Description                                                                                                                                                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App name**     | Replaces "Tale" in the browser tab title and in the page header. The placeholder reads `e.g, Acme corp`.                                                                                                                                                                |
| **Text logo**    | Optional short string rendered next to the logo image in the navigation bar — useful when the image alone does not carry the name.                                                                                                                                      |
| **Logo**         | The image shown in the navigation bar. Upload PNG, JPEG, or SVG; SVG is recommended for crisp rendering at every viewport. Separate light- and dark-mode variants let you ship a dark-on-light logo for the light theme and a light-on-dark version for the dark theme. |
| **Favicon**      | The 64 × 64 icon Tale serves to the browser tab. Like the logo, light and dark variants are accepted.                                                                                                                                                                   |
| **Brand color**  | Primary colour — used for buttons, active states, focus rings.                                                                                                                                                                                                          |
| **Accent color** | Secondary colour — used for highlights and badges.                                                                                                                                                                                                                      |

The form previews the rendered header live as you edit, so the colour and logo choice is visible before you save.

## Light and dark variants

Both the logo and the favicon accept separate light- and dark-mode files. The active mode follows each user's theme preference — set under [Your preferences](/platform/member/preferences) — which means a single brand can ship two visually distinct logos without an explicit mode switch in the UI. Upload only one variant and Tale uses it for both modes.

## Colours

Colours are entered as hex codes. Tale checks each picked colour against the background contrast ratio and warns when it falls below the 4.5:1 ratio that WCAG AA requires for normal text; the colour picker suggests a close alternative that passes. The warning does not block the save — you can override it when the brand book demands it — but the audit log records the override.

## Where this fits

Branding is the surface-level customisation layer. It changes how Tale presents itself to the team and to the people the team's emails reach; it does not change what the product does, what models exist, or what roles can do. Treat the settings here as cheap and reversible — every field has a reset icon that restores the Tale default in one click, so you can experiment without committing.

For the deeper customisation surfaces — the model menu, the retention policy, the role matrix — [AI providers](/platform/admin/providers), [Governance](/platform/admin/governance), and [Members and roles](/platform/admin/members-and-roles) are the pages.
