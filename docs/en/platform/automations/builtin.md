---
title: Built-in automations
description: What each of the eight shipped automations does — mail sync and triage for Gmail, Outlook, and IMAP, and issue scoring and pull-request review for GitHub — and the connector each needs before you deploy it.
---

Tale ships eight automations, and every organization starts with all of them in place: three that pull a mailbox into the shared **Inbox**, three that digest what arrived there, and two for GitHub — one that scores open issues, one that reviews open pull requests. Each arrives as version 1 with its schedule already bound and the **Not deployed** badge on, so nothing runs until an Owner, Admin, or Developer connects the connector it needs and deploys it. This page names what each pack does, how often it runs, and what it needs; the mechanics of deploying live on [The workflow editor](/platform/automations/editor).

<Frame caption="The Automations page on a fresh organization — each seeded pack is one version wearing Not deployed until you deploy it.">

![The Automations page listing seeded automations named github-review-pull-requests, github-triage-issues, gmail-triage-inbox, imap-smtp-triage-inbox, and outlook-triage-inbox, each with one version and a Not deployed badge, below the Upload package and New automation buttons.](/images/platform/automations-catalog.webp)

</Frame>

## How the packs arrive

The packs are seeded when the organization is created, not installed from a catalog. Seeding is careful about what is already there: a pack the organization already holds any version of is left alone — only its shipped name and description refresh — and a pack you deleted stays deleted, so a later deploy never brings it back. Open a pack like any automation to read its document on the canvas, follow its [run list](/platform/automations/execution-logs), change its [trigger](/platform/automations/triggers), or edit it — an edit becomes a new version you deploy when ready.

## Sync a mailbox into the Inbox

**Sync Gmail emails**, **Sync Outlook emails**, and **Sync emails via SMTP/IMAP** are the same automation three times, one per mailbox kind. Each pulls new messages into conversations every five minutes and declares the **Inbox** view: once one of them is deployed, **Inbox** appears in the navigation and the compose form offers the connected mailbox — until then the Inbox page points you to **Automations**. Each needs its mail connector connected first.

| Automation                | Requires  | Schedule        |
| ------------------------- | --------- | --------------- |
| Sync Gmail emails         | Gmail     | Every 5 minutes |
| Sync Outlook emails       | Outlook   | Every 5 minutes |
| Sync emails via SMTP/IMAP | IMAP/SMTP | Every 5 minutes |

## Digest what arrived

**Triage the Gmail inbox**, **Triage the Outlook inbox**, and **Triage the IMAP inbox** read the newest messages from every connected mailbox of their kind every six hours and write one digest: a short summary of what came in and the messages that plainly need a reply today. The digest is the run's output — open the run in the [run list](/platform/automations/execution-logs) to read it. Nothing is written back to the mailbox and no conversation changes state.

| Automation               | Requires  | Schedule      |
| ------------------------ | --------- | ------------- |
| Triage the Gmail inbox   | Gmail     | Every 6 hours |
| Triage the Outlook inbox | Outlook   | Every 6 hours |
| Triage the IMAP inbox    | IMAP/SMTP | Every 6 hours |

## Score issues and review pull requests on GitHub

**Triage GitHub issues** lists a repository's open issues once a day at 07:00 UTC, scores each one for whether it is actionable and how urgent it is, and returns a ranked shortlist with a one-sentence reason per issue. It reads only: nothing is written to GitHub, and no task is created on any board — the shortlist is a report a person acts on. **Review GitHub pull requests** reads every open pull request's diff every thirty minutes, reviews it, and posts the findings as a review comment on the pull request. It never approves and never merges; a person still does that. Both need the GitHub connector connected.

| Automation                  | Requires | Schedule           | Writes                                        |
| --------------------------- | -------- | ------------------ | --------------------------------------------- |
| Triage GitHub issues        | GitHub   | Daily at 07:00 UTC | Nothing — the ranked list is the run's output |
| Review GitHub pull requests | GitHub   | Every 30 minutes   | One review comment per open pull request      |

## Where this fits

Eight packs, two families: mail pulled into the Inbox and digested, GitHub scored and reviewed — each a normal automation you deploy, edit, and version like your own. [Add automations](/platform/automations/catalog) covers authoring on the canvas and uploading packs of your own; [The workflow editor](/platform/automations/editor) covers taking a version live; [Project Backlog](/platform/projects/backlog) explains the board status that proposed work uses — and why nothing shipped fills it automatically.
