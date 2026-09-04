---
title: Preferences
description: The member-level settings that follow you across orgs and chats — name and password under Account, theme and locale in the profile menu, your memories, and sign-out.
---

Preferences are the dials that belong to you rather than to the org. Your name is what agents and teammates see in chats and approvals. Your locale and theme follow you between devices. Your memories are facts an agent has proposed about you and you have approved, kept separately from anything an Admin or Editor has set at the org level. This page maps where each lever lives and what it changes.

The shape is intentionally two-layered: the profile menu (everywhere, one click from the avatar) carries the quick toggles; **Settings > Account** and **Settings > Preferences** carry the deeper account fields. Everything here is yours — none of it leaks to other members or other orgs.

## The profile menu

Click your avatar in the top-right. The dropdown opens with your name, your email, and the current build version. Below the header sit four quick controls every member sees regardless of role: the **theme** switcher (System / Light / Dark), the **language** sub-menu (English, Deutsch, Français), the **Get app** row when the browser can install Tale as a PWA, and **Log out**. Theme and language take effect immediately and persist per-device.

The menu also carries an organisation switcher when you belong to more than one org and a team filter when your current org has teams. Those are not preferences — they change what Tale shows you, not how Tale behaves. Below the team filter, **User settings** opens **Settings > Account**, the page covered next.

## Account — name, email, password, two-factor

Open **Settings > Account**. Three sections sit on the page: **Profile**, **Security**, and **Two-factor authentication**.

The Profile section shows your **email** first, then your **name** — the email implies the name Tale suggests, which you can edit freely. The name is editable inline; the change saves and propagates to every chat and approval the next time they render. Email is read-only — it is what you signed in with, and changing it goes through support. There is no avatar field on the page; Tale derives an avatar from your name's initials.

The Security section holds a single button: **Change password** if you signed up with email and password, **Set password** if your account is federated through SSO and you want to add a password as a fallback. Both flows enforce the org's password policy and surface the rules live as you type, and a wrong current password is flagged inline on the field rather than as a transient error. Changing your password signs you out of every device — the dialog warns you before you confirm, and you'll sign back in with the new password. The Two-factor section pairs the account with a TOTP app or a hardware key and shows the backup codes once at enrolment.

## Memories, and the approval gate on them

A memory is a short fact about you that an agent suggested and you kept — a preference you stated, a constraint you keep repeating, a context worth carrying between chats. Memories are the one part of your account an agent can write to, which is why the write goes through you first.

Proposing one is something the model does by calling a tool, not a background process reading your conversations. The call writes the entry as **pending** and records an audit line at the same time, because proposing durable state about a person is worth logging even before anyone agrees to it. A pending entry does nothing on its own: it waits as a suggestion in **Settings > Preferences** until you save it or discard it, and only a saved memory can ever be read back.

<Info>

Nothing is added to a prompt on your behalf. A saved memory reaches a reply only when the model searches for it and the search returns it — a model cannot give itself durable knowledge about you by writing it down, and it cannot quietly consult a suggestion you declined.

</Info>

Saved memories are listed on the same page with a control to delete each one. Deleting a memory takes it out of what a search can return, which is the whole of its effect — no second copy is riding along in some other prompt.

## Signing out

The **Log out** row at the bottom of the profile menu confirms with a dialog before clearing the session. After confirming, Tale does a full page reload to the sign-in page so no stale state lingers in the tab. Sign-out is per-device — signing out on your laptop does not log you out on your phone, and vice versa.

## Where this fits

Preferences are the line between you and the rest of the org. The org Admin sets the defaults — the password policy, which models are allowed, what governance applies to a chat — and your preferences override them where Tale lets them. The next read worth queuing is [Member overview](/platform/member/overview) for the map of the rest of the Member surface, or [Install as app](/platform/member/install-as-app) if you want Tale to live in your dock rather than your browser tabs.
