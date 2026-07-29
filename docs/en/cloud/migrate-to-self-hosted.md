---
title: Migrate to self-hosted
description: When self-hosting beats Cloud, what moves and what does not, and how to carry your org across without breaking running agents.
---

Migration from Cloud to self-hosted is a real procedure, not a setting flip. The data exports, the new instance imports, DNS cuts over to the new host, and your team signs in to the same org they had — same agents, same chats, same audit history. This tutorial walks the procedure and points at where it goes wrong.

Reach for it when self-hosting genuinely fits better: data residency requires hardware you control, costs at scale make on-premise cheaper than per-token, or the org has decided to run the stack themselves. For most teams Cloud stays the right call — re-read [Cloud onboarding](/cloud/onboarding) if you are still deciding.

## Before you begin

Have these in place before exporting anything:

- A target host that meets the self-hosted prerequisites — see [Quickstart](/self-hosted/install/quickstart) for the spec.
- DNS control over the domain your org currently uses; you will swing it during the cutover.
- A maintenance window of at least an hour. The import itself is faster than that, but DNS propagation and validation add time.
- A recent backup confirmation in your Cloud org's audit log. Nothing gets deleted in the source during a migration, but the export bundle is your evidence that the source state was consistent.

## What moves and what does not

Moves: chats, threads, messages, attachments, documents, knowledge embeddings, agents, agent versions, workflows, executions, audit logs, members, roles, teams, branding, API keys, connectors metadata.

Does not move: external connectors have to be re-authenticated against the new instance (the credentials live in the provider, not in the export bundle); active running workflows pause and resume on the new instance after the cutover; voice audio retained past the org's retention window stays in the Cloud object store until purged.

## Step 1 — Export

Open **Settings > Organization** on Cloud and click **Export**. The dialog runs the export in the background and emails a download link when complete. The export is a single encrypted bundle; the email contains the decryption key. Download the bundle and store the key separately.

## Step 2 — Stand up the target instance

On the target host, follow [Quickstart](/self-hosted/install/quickstart) through the first-admin step. Do not invite users yet — the import overwrites the member list. Confirm the new instance boots and you can sign in as Owner.

## Step 3 — Import

On the target instance, sign in as Owner and visit `/_internal/import` (linked from the Settings page after a fresh install). Upload the bundle, paste the decryption key, and click **Import**. The import is a long-running operation; the page shows progress per data class. When the page resolves to **Import complete**, the new instance carries the source org's full state.

## Step 4 — Cut DNS

Update the DNS record for the org's domain to point at the new instance. Once propagation lands and the new instance's TLS is healthy, users signing in arrive at the self-hosted instance with their existing credentials. The Cloud org becomes read-only at this point — to avoid drift, archive it in **Settings > Organization** on Cloud after a few days of confidence.

## Troubleshooting

- **Export hangs at "preparing".** Very large orgs (>100 GB) take longer than the email window assumes. Open a support ticket; the export runs to completion in the background.
- **Import fails on schema mismatch.** Your target instance is running an older Tale version than the Cloud export expects. Upgrade the target before retrying — the bundle is forward-compatible, not backward-compatible.
- **Members cannot sign in after cutover.** Session cookies are scoped to the old host. Members re-authenticate once; SSO and 2FA settings carry across.
- **Workflows show "paused" after import.** Expected — the import preserves state but does not auto-resume running executions. Open each workflow and click **Resume** after confirming the target instance is reachable from any external triggers.

## Where this gets used

Migration is a one-direction operation in practice — once you self-host, you stay self-hosted unless something changes structurally. The reverse migration (self-hosted to Cloud) follows the same shape with the same tooling and is supported but rare. If you are still on Cloud and reading this for context, the page worth following up with is [Self-hosted overview](/self-hosted/overview); it names what you are taking on.
