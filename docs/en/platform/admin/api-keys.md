---
title: API keys
description: Personal bearer credentials that let external code call Tale's REST API. Admins and Developers create, rotate, and revoke them under Settings > API > REST.
---

API keys are the credentials Tale issues so external code can call its REST API without a human in the loop. A key authenticates the caller as the person who minted it and carries that person's role in the organisation. Admins and Developers manage keys; other roles cannot see the page. This is the reference for what a key is, how to create one, how it is scoped, and how to retire it without breaking anything that depends on it.

The keys listed here are different from the per-user session tokens Tale issues when someone signs in. Those are short-lived and tied to a browser; API keys are long-lived and meant for unattended callers. Reach for an API key when you wire a script, a cron job, an internal service, or a third-party connector to Tale; reach for the in-product UI when a person is at the keyboard.

<Frame caption="Settings > API > REST — where keys are created, rotated, and revoked.">

![The REST API keys settings page listing two keys, each showing only its prefix, the date it was added, and a Never used marker, beside a Create API key button.](/images/get-started/settings-api-keys.webp)

</Frame>

## Creating a key

Open **Settings > API > REST** and click **Create API key**. Give the key a name that says who or what will use it (`Billing sync`, `Slack relay`, `ops-cron`) and pick the expiration — 7, 30, or 90 days, a year, or never; the default is 30 days. Tale shows the secret exactly once on creation — copy it into your password manager or your deployment system before you close the dialog. After that, the table shows only a masked fragment of it.

The key acts as you: every request it makes carries your role in the organisation. A key minted by a Developer can read every resource and write to most; there is no way to mint a key more powerful than its creator. Since keys are exactly as dangerous as the role behind them, let the least-privileged account that can do the job mint the key.

## What the table shows

The table lists the keys you created — teammates' keys are not visible here — each by name, a masked fragment of the secret (the first and last few characters), the date it was added, and the last-used timestamp. The fragment is enough to match a row against the key you hold without exposing it. The last-used timestamp updates on every successful request the key makes; a key that has not been used for weeks is usually safe to retire.

There is no search or filter row — an org holds a handful of keys, and a deliberate naming scheme keeps the table scannable.

## Rotating a key

To rotate, create the new key first, deploy it to the system that uses the old one, verify the new key works (the last-used timestamp updates), and only then revoke the old one. Tale does not auto-rotate keys; the discipline of overlap is yours to keep. Rotation is the right move whenever a key is suspected of having leaked, whenever someone with access to the key leaves the organisation, or on whatever cadence your security policy mandates.

## Revoking a key

Open the key's row menu and click **Revoke key**, then confirm. A revoked key stops authenticating immediately — any in-flight request completes, but the next one fails with `401` — and the row disappears from the table. There is no undo for revocation; if you revoke the wrong key, mint a new one.

## Scopes and limits

Each key carries the permissions of its creator's role at the time of every request, not the time of creation. Change the person's role — or disable their membership — and every key they minted inherits the change on the next request. Requests through the REST API are rate-limited per calling address, and a [governance budget rule](/platform/admin/governance/policies-and-limits) can cap what a single key spends on models.

## Where this fits

API keys are the bridge between Tale and external code; they sit beside [Connectors](/platform/admin/connectors) (third-party systems Tale calls out to) and [Automation webhook triggers](/platform/automations/triggers) (systems that call into Tale on events). The natural next read is the REST API itself — see the API reference in the Develop tab for the surface a key authenticates against, and see [Members and roles](/platform/admin/members-and-roles) for the role-to-permission map every key inherits.
