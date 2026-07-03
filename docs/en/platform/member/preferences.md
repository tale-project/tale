---
title: Preferences
description: The member-level settings that follow you across orgs and chats — name and password under Account, theme and locale in the profile menu, custom instructions and memories under Personalization, and sign-out.
---

Preferences are the dials that belong to you rather than to the org. Your name is what agents and teammates see in chats and approvals. Your locale and theme follow you between devices. Your custom instructions and memories shape how agents reply to you specifically — separately from anything the Admin or Editor has set at the org level. This page maps where each lever lives and what it changes.

The shape is intentionally two-layered: the profile menu (everywhere, one click from the avatar) carries the quick toggles; **Settings > Account** and **Settings > Personalization** carry the deeper account fields. Everything here is yours — none of it leaks to other members or other orgs.

## The profile menu

Click your avatar in the top-right. The dropdown opens with your name, your email, and the current build version. Below the header sit four quick controls every member sees regardless of role: the **theme** switcher (System / Light / Dark), the **language** sub-menu (English, Deutsch, Français), the **Get app** row when the browser can install Tale as a PWA, and **Log out**. Theme and language take effect immediately and persist per-device.

The menu also carries an organisation switcher when you belong to more than one org and a team filter when your current org has teams. Those are not preferences — they change what Tale shows you, not how Tale behaves. Below the team filter, **User settings** opens **Settings > Account**, the page covered next.

## Account — name, email, password, two-factor

Open **Settings > Account**. Three sections sit on the page: **Profile**, **Security**, and **Two-factor authentication**.

The Profile section shows your **email** first, then your **name** — the email implies the name Tale suggests, which you can edit freely. The name is editable inline; the change saves and propagates to every chat and approval the next time they render. Email is read-only — it is what you signed in with, and changing it goes through support. There is no avatar field on the page; Tale derives an avatar from your name's initials.

The Security section holds a single button: **Change password** if you signed up with email and password, **Set password** if your account is federated through SSO and you want to add a password as a fallback. Both flows enforce the org's password policy and surface the rules live as you type, and a wrong current password is flagged inline on the field rather than as a transient error. Changing your password signs you out of every device — the dialog warns you before you confirm, and you'll sign back in with the new password. The Two-factor section pairs the account with a TOTP app or a hardware key and shows the backup codes once at enrolment.

## Personalization — custom instructions, memories, voice output

Open **Settings > Personalization**. The page gates each feature with an on/off toggle that follows the org default until you override it.

**Custom instructions** is a free-form text field — up to 4,000 characters — that every agent receives as additional context for your conversations specifically. Use it for the things you would otherwise say at the top of every chat: your role, your preferred reply style, the projects you are working on, the constraints the agent should respect. The org default decides whether the feature is on for new members; your toggle overrides it for your own account.

**Memories** are short facts the agent saves about you between chats — a topic you asked about, a preference you stated, a context you would not want to repeat. Saved memories appear in a list with a delete button on each row; pending memories surface in their own section with **Approve** and **Dismiss** controls so nothing lands in your record without you seeing it. Toggle the feature off and existing memories stop being used until you turn it back on.

**Voice output** picks the voice an agent uses when it speaks in voice mode. The setting only applies when the org has a voice provider configured; otherwise the section explains the gap and points at the Admin.

## Signing out

The **Log out** row at the bottom of the profile menu confirms with a dialog before clearing the session. After confirming, Tale does a full page reload to the sign-in page so no stale state lingers in the tab. Sign-out is per-device — signing out on your laptop does not log you out on your phone, and vice versa.

## Where this fits

Preferences are the line between you and the rest of the org. The org Admin sets defaults — including whether personalization is on for new members, what the password policy is, which models are allowed — and your preferences override the defaults where Tale lets them. One personal page sits apart from this set: [Environment variables & secrets](/platform/member/environment) holds variables and credentials scoped to you within a single organisation rather than following you across them — the place to keep the provider key a bring-your-own agent uses. The next read worth queuing is [Member overview](/platform/member/overview) for the map of the rest of the Member surface, or [Install as app](/platform/member/install-as-app) if you want Tale to live in your dock rather than your browser tabs.
