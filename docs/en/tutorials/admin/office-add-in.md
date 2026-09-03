---
title: Install the Outlook add-in
description: Roll out the Tale sidebar inside Outlook and Microsoft 365 so members can draft replies with Tale agents without leaving their inbox.
---

The Outlook add-in surfaces a Tale sidebar inside Outlook on the web, desktop, and mobile. From the sidebar a member picks an agent, drops the open mail thread in as context, and gets a draft reply back without switching apps. This walk is for an Admin rolling the add-in out across an org; it covers the manifest deploy, the sign-in, and the verification.

You need an Admin role in Tale, a Microsoft 365 tenant where you can manage Integrated Apps, and a Tale instance reachable from the Microsoft 365 cloud. Cloud orgs are reachable by default; self-hosted instances need a public HTTPS URL.

## Before you begin

Confirm three things on the Microsoft side: you are a Global Administrator (or have the Exchange Admin role with Integrated Apps), centralised deployment is enabled for your tenant, and the mailbox you will test with has not blocked add-ins via mailbox policy. On the Tale side, open **Settings > Connectors** and check that **Microsoft 365** is listed — that is where the add-in publishes the manifest URL.

## Step 1 — Get the manifest URL from Tale

The add-in talks to Tale through a manifest XML the Microsoft 365 admin centre hosts. Tale generates the manifest per instance so the sidebar points at your URL, not at a shared multi-tenant endpoint. Open **Settings > Connectors > Microsoft 365** and copy the **Add-in manifest URL** the panel shows.

You should see a URL ending in `/connectors/office/manifest.xml`. Open it in a new tab to confirm it returns XML and not an HTML error page — if it errors, your instance is not reachable from outside or the connector is disabled.

## Step 2 — Deploy through the Microsoft 365 admin centre

The manifest is what tells Microsoft 365 which mailboxes can see the sidebar and what URL to load it from. Centralised deployment is the supported path; user-by-user side-loading works but does not survive a mailbox migration.

Open the Microsoft 365 admin centre, navigate to **Settings > Integrated apps > Upload custom apps**, choose **Office Add-in** and **Provide link to manifest file**, and paste the URL from Step 1. Pick the rollout audience — the whole tenant, a security group, or a specific list of users.

Submit. Microsoft confirms the deployment with a green banner; the rollout typically reaches mailboxes within an hour, sometimes a few hours on a large tenant.

## Step 3 — Sign in from the sidebar

Open Outlook as a user in the rollout audience, click any mail message, and look for the Tale icon in the message ribbon. Clicking it opens the sidebar; on first open it asks the user to sign in with their Tale account. The sign-in is OAuth through the Tale instance — same identity provider as the web app.

After sign-in the sidebar lists the user's available agents. Picking one and clicking **Draft reply** pulls the open mail thread in as context and streams a reply into the sidebar. The user reviews, edits, and clicks **Insert** to drop it into the Outlook compose pane.

## Where this fits

The add-in is the lightest path to "Tale where your members already work" — no portal switch, no copy-paste. The sidebar is a thin shell around the same chat you use in Tale — see [Chat](/platform/chat/overview); agents in this version work board tasks rather than answering in chat, so there is nothing to publish into the sidebar.

For the broader connector story — Slack, Gmail, and the other shipped connectors — see [Connectors overview](/platform/connectors/overview). If you operate a self-hosted instance and the manifest URL is unreachable from Microsoft 365, the [Linux server](/self-hosted/install/linux-server) page covers the public-HTTPS prerequisite.
