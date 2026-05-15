---
title: Your preferences
description: Per-user settings — password, display name, interface language, theme, and notification preferences. Edit them from Account in the avatar menu.
---

Your preferences are the per-user surface for personal settings — password, language, theme, notifications, display name. They live under **Account**, reachable from your avatar in the bottom-left corner. Every role — Member, Editor, Developer, Admin, Owner — can edit their own preferences from the same screen; the page is identical across roles.

Nothing on this page changes anything for the rest of the organisation. The changes you make here only affect how Tale presents itself to you. For organisation-wide settings (branding, governance, providers), an Admin works from [Admin](/platform/admin/overview).

## Password

Change the password you use to sign in. The form asks for your current password and the new one, plus a confirmation. The new password is checked against the org's password policy (length, character classes), so a too-weak password is rejected before the form submits.

If you signed up through SSO or trusted headers and never had a password, the same form lets you _set_ one. Adding a password enables direct email-and-password sign-in in addition to your existing federated route.

## Display name

The name shown in the sidebar, chat messages, and comments. Admins can override your display name from **Settings > Members**, but when they have not, the field is yours to edit. Pick something the rest of the team recognises — the name is what shows up next to your messages, not your email.

## Language

Pick the interface language. Tale ships English, German (with a Swiss variant), and French. The language preference applies to the platform UI and to system messages; it does _not_ change the language of documents you have uploaded or the style of the AI's replies, which follow the content and the agent's instructions.

For agents, the org-wide default response language is set by the Admin under **Settings > Organization > Agent response language**; your interface language follows your own setting independently.

## Theme

Choose between **Light**, **Dark**, and **System**. **System** follows your operating system's light or dark setting and updates live when it changes — useful when you switch between bright desks and dim evenings on the same laptop.

## Notifications

Opt in or out of email notifications for approval requests, conversation assignments, and workflow completions. Each toggle is independent; the in-product notifications stay regardless of the email toggles.

## Where this fits

Preferences are the per-user surface — your password, your language, your theme, your notification preferences. They do not change anything for the rest of the organisation; they only change how Tale presents itself to you. For organisation-wide settings (branding, retention, governance, providers), an Admin works from [Admin](/platform/admin/overview); for the second factor on your account (TOTP and backup codes), see [Two-factor authentication](/platform/admin/two-factor-authentication).
