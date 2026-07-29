---
title: API keys
description: Org-wide credentials that let external code call Tale's REST API on behalf of the organisation. Admins and Developers create, rotate, and revoke them under Settings > API keys.
---

API keys are the org-wide credentials Tale issues so external code can call its REST API without a human in the loop. A key authenticates the caller as the organisation, scoped by the role you pick when you mint it. Admins and Developers manage keys; other roles cannot see the page. This is the reference for what a key is, how to create one, how to scope it, and how to retire it without breaking anything that depends on it.

The keys listed here are different from the per-user session tokens Tale issues when someone signs in. Those are short-lived and tied to a person; API keys are long-lived and tied to the organisation. Reach for an API key when you wire a script, a cron job, an internal service, or a third-party integration to Tale; reach for the in-product UI when a person is at the keyboard.

<Frame caption="Settings > API keys — where keys are created, rotated, and revoked.">

![The REST API keys settings page listing two keys, each showing only its prefix, the date it was added, and a Never used marker, beside a Create API key button.](/images/get-started/settings-api-keys.webp)

</Frame>

## Creating a key

Open **Settings > API keys** and click **Create API key**. Give the key a name that says who or what will use it (`Billing sync`, `Slack relay`, `ops-cron`), pick the role it should carry, and pick the expiry. Tale shows the secret exactly once on creation — copy it into your password manager or your deployment system before you close the dialog. After that, only the key's prefix is visible from the table.

The role you pick scopes everything the key can do. A key carrying the Developer role can read every resource and write to most; a key carrying the Member role can read the knowledge base and start chats but not configure anything. Pick the smallest role that does the job — keys are exactly as dangerous as the role they carry.

## What the table shows

The API keys table lists each key by name, prefix, role, creator, last-used timestamp, and expiry. The prefix is the first eight characters of the secret — enough to identify the key in logs without exposing it. The last-used timestamp updates on every successful request the key makes; a key that has not been used for weeks is usually safe to retire.

The filter row lets you narrow by role, by creator, and by expiry window. The default sort is most-recently-created first; the secondary sort is most-recently-used.

## Rotating a key

To rotate, create the new key first, deploy it to the system that uses the old one, verify the new key works (the last-used timestamp updates), and only then revoke the old one. Tale does not auto-rotate keys; the discipline of overlap is yours to keep. Rotation is the right move whenever a key is suspected of having leaked, whenever someone with access to the key leaves the organisation, or on whatever cadence your security policy mandates.

## Revoking a key

Click the row, then **Revoke**. A revoked key stops authenticating immediately — any in-flight request completes, but the next one fails with `401`. Revoked keys stay in the table for the audit trail; the row badges them as revoked and shows who revoked them and when. There is no undo for revocation; if you revoke the wrong key, mint a new one.

## Scopes and limits

Each key carries the permissions of its role at the time of every request, not the time of creation. If you change a role's permissions through a governance policy, every key that carries that role inherits the change on the next request. The org's rate limits apply per key, not per organisation; a noisy key does not throttle a quiet one.

A key can be restricted further by IP allowlist on creation. The allowlist takes a comma-separated list of CIDR blocks; requests from outside the list fail with `403`. Reach for the IP allowlist when the calling system has a stable egress and you want defence in depth.

## Where this fits

API keys are the bridge between Tale and external code; they sit beside [Integrations](/platform/admin/integrations) (third-party systems Tale calls out to) and [Automation webhook triggers](/platform/automations/triggers) (systems that call into Tale on events). The natural next read is the REST API itself — see the API reference in the Develop tab for the surface a key authenticates against, and see [Members and roles](/platform/admin/members-and-roles) for the role-to-permission map every key inherits.
