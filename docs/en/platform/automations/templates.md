---
title: Automation templates
description: Browse the automations Tale ships, preview what each one does and needs, and make one your own in a few questions, as a draft or started at once.
---

A new organization starts with no automations. Everything Tale ships — mail syncs, inbox triage, issue syncs, code review, digests and notifications — is a template in one catalog. You preview a template, answer a few questions such as the project it serves, the mailbox it reads or when it runs, and Tale creates it as your own automation, which you change like any other. Only the Owner, Admin and Developer roles create automations.

## Browse the catalog

1. Open **Automations** and select **Create automation** › **From a template**. While your organization has no automation, **Browse templates** in the empty list opens the same catalog.
2. Narrow the catalog with the category tabs — **All**, **Inbox**, **Issues**, **Code review**, **Tasks**, **Notifications** and **Webhooks** — or search by name.

Each card shows the product the template works with, what it does in one line and when it runs. **Connect first** marks a template that needs a connector your organization has not connected yet. **In use** says that you already made an automation from it, and how many.

![The Templates dialog with its category tabs, from All to Webhooks, the search, and a grid of template cards, each with its product's logo, its name, when it runs and one line; some cards read Connect first or In use.](/images/platform/automation-template-catalog.webp)

## Preview a template

Select a card to open its preview.

| Part | What it says |
| --- | --- |
| **How it works** | Its steps in order, in plain words. |
| **What it changes** | What it creates, changes or sends, and what it never does. |
| **When it runs** | The schedule, the platform event or the webhook that starts it. |
| **What it needs** | The connectors it uses and whether they are connected. **Connect** opens **Settings** › **Connectors**. A template that only works on what another one brings in, such as an inbox summary on the inbox a mail sync fills, points to **Works with** instead. |
| **Works with** | Templates made to run beside it, such as the mail sync that fills the inbox a triage reads. |
| **Workflow** | Its steps as the editor will show them, read-only. |

![The preview of Triage the Gmail inbox: what it does, its tags Inbox and In use, How it works in four numbered steps, What it changes, When it runs every 6 hours in your time zone, What it needs with Gmail not connected and a Connect link, Works with Sync Gmail emails, and its workflow drawn read-only from Start to the Inbox step, above Use this template.](/images/platform/automation-template-preview.webp)

## Use a template

1. In the preview, select **Use this template**.
2. Answer its questions. **Name** starts as the template's name; change it to tell your automations apart. A question about a credential offers the ones in service for its connector; when it is optional, its first choice says what leaving it empty means, such as the default connection. A schedule starts in your own time zone, and you can pick another.
3. Leave **Start it now** on to deploy version 1 and turn its trigger on in the same step. Turned off, the automation is created as a draft with its trigger off, which you deploy from the [editor](/platform/automations/editor). **Start it now** is not available while a connector the template needs is not connected. When a question asks for one of that connector's credentials, there is nothing to choose yet: connect it first, then create the automation.
4. Select **Create automation**. The new automation opens.

![The questions of Tell the reviewer: its name, the project Website relaunch, the reviewer Priya Raman, the message, and Start it now checked, above Create automation.](/images/platform/automation-template-setup.webp)

Creating is one step: when anything is refused, nothing is created and nothing is half started. When Tale cannot use an answer — a project you cannot open, someone who is not a member of the organization, a credential that is not in service, a number outside what the question takes — the question says why. A name another automation already has is refused as well; choose a different one.

From a project's own **Automations** list, a template that serves a project starts with that project picked, and the new automation opens in the project.

A template that a webhook starts shows its address once, right after the automation is created. Copy it before you select **Open the automation**: only a hash of its token is kept, so a lost address can only be replaced with **Rotate token**, as [Receive a webhook](/platform/automations/triggers#receive-a-webhook) explains.

A template names a model for its language model steps. When none of your providers serves it, each such step gets a comparable model they do serve, and the message of version 1 says which. When your organization has no provider at all, the steps keep the template's model, and validation warns about it when you save: choose a served model with **Change model**, which swaps it in every step at once.

An organization created before templates may still have the mail, GitHub and GlitchTip automations an earlier release installed. They stay as they are, and the catalog counts each one whose template still ships as **In use**. The GitHub and GlitchTip issue importers of an earlier release have no template any more: [Sync GitHub issues](#github-sync-issues) and [Sync GlitchTip issues](#glitchtip-sync-issues) take their place, and an importer you already have is not counted for either.

## Inbox

The mail syncs fill the shared **Inbox** that the inbox templates read. Deploying a mail sync adds the **Inbox** view to [Home](/platform#home) and offers its mailbox in the compose form. Until one is deployed, Home has no **Inbox** view, and a link to the inbox shows a setup notice instead: for Owners, Admins and Developers it opens this catalog on its **Inbox** tab; everyone else is told that one of those roles must deploy an email automation.

### Sync Gmail emails {#gmail-sync-emails}

Brings the email of your connected Gmail mailboxes into the **Inbox**, every five minutes to start with. It reads each mailbox's Inbox folder and, unless you turn it off, its Sent folder, so a thread holds what a customer wrote and what you answered from Gmail itself. It needs the Gmail connector.

| Question | What it decides |
| --- | --- |
| **When** | How often a pass runs, in your time zone. Every five minutes to start with. |
| **Mailbox** | Which connected Gmail mailbox it reads. **Every connected Gmail mailbox**, the first choice, reads each one from where it stopped; a connection's name reads that mailbox only. |
| **Days to read back** | How far back a mailbox's first pass reaches, from 0 to 90 days; 7 to start with. With 0, only email that arrives from then on is read. Older email is never read. |
| **Read Sent too** | Whether the Sent folder is read as well. On to start with. |
| **Emails per pass** | The most emails one pass reads from each mailbox, from 10 to 100; 50 to start with. |

Each pass continues where the last one stopped and reads the oldest email first, Sent and Inbox in the order the emails happened, so your own message lands before the answer to it. A backlog larger than one pass, on a mailbox's first pass or after a pause, is read over the passes that follow, and no email is skipped or stored twice. The sync keeps its place by the time Gmail received each email, never by the date its sender wrote, so a sender's wrong clock cannot make it skip mail. An email you send from the **Inbox** is stored once, even when a pass reads it again from Sent.

When Gmail asks the sync to slow down, the pass stops, keeps what it read, and the next pass continues; the run still succeeds. An email deleted or moved after a pass listed it is skipped. When a mailbox cannot be read, for example because its connection expired, the other mailboxes are still read and the run names the one that failed. Only when every mailbox fails does the run fail, so the automation's failure notices go out.

The run's output lists under `mailboxes` what the pass did in each mailbox:

| Field | What it says |
| --- | --- |
| `listed` | Emails that arrived after the place the pass started from. |
| `fetched` | Emails it read. |
| `ingested` | Emails stored for the first time. |
| `duplicates` | Emails it read again that were stored already. |
| `skipped` | Emails that cannot be stored: no Message-ID, or no one to file them under. |
| `vanished` | Emails deleted or moved before the pass could read them. |
| `capped` | `true` when more email is waiting than one pass reads. The next pass continues. |
| `rateLimited`, `retryAfter` | Gmail asked the sync to slow down, and when it allows the next try, if it said. |
| `error` | Why the pass stopped early. |
| `resumeFrom` | Where the next pass starts, per folder. |

The sync tells the mailbox's own email from a customer's by the mailbox address, which the first pass learns from the connected account and keeps on the connection as its From address. Attachments are stored with their message, so you open and download them from the conversation. Gmail hands over each attachment only up to 3.5 MB: a larger one is still listed with its name and size, but you open it in Gmail.

The sync only reads. It never sends, deletes, moves or marks an email in Gmail, and what happens to an email in Gmail after it was read, such as marking it read or deleting it, does not reach the **Inbox**. An email moved into the Gmail Inbox after the sync has passed the time it first arrived is not read.

After the first live run, open its [execution log](/platform/automations/execution-logs) and check that the expected messages appear in the **Inbox** view in Home.

### Sync Outlook emails {#outlook-sync-emails}

Works like [Sync Gmail emails](#gmail-sync-emails) for connected Outlook mailboxes, with the same questions, every five minutes to start with. It needs the Outlook connector. It keeps its place by the time Exchange received each email, or sent it for the Sent Items folder. When Outlook asks the sync to slow down, the run names the wait Outlook gives. Attachments are stored with their message.

### Sync emails via SMTP/IMAP {#imap-smtp-sync-emails}

Works like [Sync Gmail emails](#gmail-sync-emails) for mailboxes connected over IMAP and SMTP, with the same questions, every five minutes to start with. It needs the IMAP/SMTP connector. It keeps its place by the time the mail server took each email in, and takes the mailbox address from the login. Sent mail is read from the folder the server marks as Sent, or else from the one the connection names. When the server drops the connection during a pass, the pass keeps what it read and the next one continues; if that was the only mailbox, the run fails.

### Triage the Gmail inbox {#gmail-triage-inbox}

Works on the **Inbox** that [Sync Gmail emails](#gmail-sync-emails) fills, every six hours in your time zone to start with. Each run reads the open Gmail conversations whose newest message is the customer's and that no earlier pass has judged since that message arrived — up to **Conversations per run** (20 to start with, at most 40); the others wait for the next run. The model decides for each thread whether a person has to reply, and how urgent it is.

What a run changes:

- Where a reply is due, a second model call drafts one and leaves it on the thread as a **Suggested reply**: a card above the composer, apart from anything a person typed. **Put in editor** hands the text to the composer to edit and send; **Discard** drops it, and the thread is not proposed on again until the customer writes again. A thread that already carries a suggestion keeps it, so a thread never holds two.
- The thread's **priority** is set to the model's verdict, but only when nobody has set one. A priority a person chose stays as it is.
- Last, the verdict is recorded on each thread, with its reason, so the next run looks at the thread again only when the customer writes again. A thread whose suggested reply could not be left — it was closed meanwhile, or its draft failed — is not marked, and the next run tries it again; the other threads are handled all the same. When no suggested reply at all could be left, the run fails and marks nothing.

Nothing is sent by the automation. The run's output lists what was read, the model's summary, the threads that need a reply with their Inbox links, the suggestions it left, and the threads it left for the next run (`unstamped`). A run with nothing waiting makes no model call.

### Triage the Outlook inbox {#outlook-triage-inbox}

Works like [Triage the Gmail inbox](#gmail-triage-inbox) on the Outlook conversations that [Sync Outlook emails](#outlook-sync-emails) brings in.

### Triage the IMAP inbox {#imap-smtp-triage-inbox}

Works like [Triage the Gmail inbox](#gmail-triage-inbox) on the conversations that [Sync emails via SMTP/IMAP](#imap-smtp-sync-emails) brings in.

### Summarize the inbox {#inbox-summary}

On its schedule — weekdays at 08:00 in your time zone, unless you change it — summarizes the conversations of the mailbox you pick that still wait for an answer, one line each, most urgent first, and sends the summary to the member you choose with a link to the inbox. An empty inbox sends nothing. It reads the inbox a mail sync fills and changes no conversation.

## Issues

The issue templates read the source and write Tale tasks. They never comment on, close or change the upstream issue, pull request or alert, and they do not start an agent.

### Sync GitHub issues {#github-sync-issues}

Keeps a project's tasks in step with the open issues of a GitHub repository, one batch every run, every 15 minutes to start with. It needs the GitHub connector with read access to the repository's issues.

Each run reads the next batch of open issues from where the last run stopped, oldest first, up to **New issues per run** (100 to start with, 1–500), and makes a task in **Backlog** for each issue the project does not have yet. A large repository therefore arrives over several runs; after the last issue, the next run starts again from the first, and an issue the project already has is refreshed, never made twice. **Only issues with these labels** narrows what it reads: with several labels, an issue needs all of them. Pull requests are left out; [Sync GitHub pull requests](#github-sync-pull-requests) reads them.

Each run also reads up to 50 issues imported earlier again, the longest-unchecked first, closed ones and ones that no longer match the labels included, and updates the task's source card: the title, the description and whether the issue is open or closed. The task's own title, description, status, assignee and priority stay as they are in Tale, and a task stays where it is when its issue is closed on GitHub. An issue GitHub no longer shows keeps its last known details and is marked unavailable. When it imports an issue, Tale cuts a title over 200 UTF-16 code units or a description over 20,000 (most emoji count as 2) to that length on the task, ending it in "…"; the source card and the issue keep the full text.

The run's output is a receipt for the repository: what it read, created, refreshed and skipped, and whether it reached the end of the open issues. An issue GitHub refuses to show is skipped and tried again later. When GitHub rate-limits the sync, the run keeps what it did, and the next runs leave GitHub alone until the time GitHub named. A run fails only when the repository could not be read at all, so the schedule counts a broken sync, not a busy GitHub. Choose **GitHub credentials** when your organization has more than one; empty uses the default ones. Changing the labels starts the next run from the first matching issue. To sync several repositories in one automation, see [Sync issues on a schedule](/platform/automations/triggers#sync-issues-on-a-schedule).

### Sync GlitchTip issues {#glitchtip-sync-issues}

Keeps a project's tasks in step with the unresolved issues of a GlitchTip project, one batch every run, the way [Sync GitHub issues](#github-sync-issues) does for a repository. It needs the GlitchTip connector with its instance URL and a token with `project:read` and `event:read`; a token that can only set up projects cannot read issues. A self-hosted instance must be allowed by the deployment's connector host policy.

Each run reads the next batch, the first seen first, and **Search** narrows it in GlitchTip's search syntax; empty, it reads every unresolved issue. Each run also reads up to 50 issues imported earlier again and updates the task's source card: the title, the details and whether the issue is unresolved, resolved or ignored. A task stays where it is when its issue is resolved. **GlitchTip credentials** names the instance and token to read with; empty uses the default ones. Changing the search starts the next run from the first matching issue.

### Sync GitHub pull requests {#github-sync-pull-requests}

Keeps a project's tasks in step with the open pull requests of a GitHub repository, one batch every run, the way [Sync GitHub issues](#github-sync-issues) does for its issues. **Only pull requests opened by** narrows it to one account's pull requests: `renovate[bot]` for Renovate's dependency updates, `dependabot[bot]` for Dependabot's; empty reads everyone's. **Only pull requests with these labels** narrows it further, and a pull request needs every label named. **New pull requests per run** sets the batch (100 to start with, 1–500). Its tasks and its place in the repository are its own, so it can run beside **Sync GitHub issues** for the same repository and project without either touching the other's tasks. A task's source card shows whether the pull request is open or closed; a merged pull request reads as closed.

### Sync GitHub security alerts {#github-sync-security-alerts}

Keeps a project's tasks in step with the open security alerts of a GitHub repository: one task per alert, every hour to start with. Choose the kind of alert under **Alerts**: code scanning, Dependabot or secret scanning. **From severity** reads only alerts at or above it, on one scale for all three kinds: critical, high, medium, or every alert. A code scanning alert that is not a security alert counts its error as high, its warning as medium and its note as low, and a secret always counts as critical. **Only code scanning tools** reads the alerts of the tools you name as GitHub shows them, such as `CodeQL` or `Trivy`; empty reads every tool's.

GitHub narrows each listing itself, so a repository with thousands of open alerts from one scanner is read only as far as the filters reach: a floor of high and the tools you act on keep the board to the alerts worth a task. Each run reads up to 100 new alerts and up to 50 alerts imported earlier again, and the source card shows an alert open, resolved (fixed, or a secret that was revoked) or ignored (dismissed). A task never shows a secret's value: the sync asks GitHub to leave it out and names only the kind of secret and where it was found. The GitHub credentials need read access to the repository's code scanning, Dependabot or secret scanning alerts, whichever you sync. To read several kinds in one automation, list them in the step's `alerts`.

### Sync Forgejo issues {#forgejo-sync-issues}

Keeps a project's tasks in step with the open issues, or the open pull requests, of a repository on a Forgejo instance, such as Codeberg or your own, one batch every run, the way [Sync GitHub issues](#github-sync-issues) does on GitHub. It needs the Forgejo connector with its instance URL and an access token that can read the repository and its issues; a self-hosted instance must be allowed by the deployment's connector host policy. **Sync** chooses whether it reads issues or pull requests, **Only items opened by** narrows them to one user's, such as `renovate`, and **Only items with these labels** to items carrying any of the labels named; Forgejo reads several labels as alternatives, where GitHub wants all of them. **Forgejo credentials** names the instance and token to read with; empty uses the default ones. Each run reads up to 100 new items and up to 50 items imported earlier again.

Each task links to the item on the instance its credentials name. The same repository on two instances makes two sets of tasks, and a task is read again only through credentials for its own instance.

### Triage GitHub issues {#github-triage-issues}

Every morning at 07:00 in your time zone to start with, reads the open issues of the repository you name that changed since its last good run, scores whether each is ready to be worked and how urgent it is, and sends the member you choose one message with the ready ones, most urgent first, each with its reason and a link to the repository's issues. It writes nothing to GitHub and creates no tasks. It needs the GitHub connector with read access to the repository's issues.

Its first run looks at the most recently changed issues. After that, each run carries on where the last run of that repository stopped, oldest change first, up to **Issues per run** (20 to start with, at most 40); the others wait for the next run. An issue is scored again only after it changes — a new comment, a new label, an edited text. A run that fails keeps no place, so its issues come back in the next run, and a run for another repository leaves this one's place as it is. An issue the model could not score is named in the message and scored again once it changes. Pull requests are left out.

The run's output lists what it scored, the ready issues with their priority and reason, the issues it could not score, and the place the next run starts from (`position`). A run with nothing ready sends nothing. To have the issues as tasks in a project as well, use [Sync GitHub issues](#github-sync-issues).

## Code review

### Review GitHub pull requests {#github-review-pull-requests}

Every 30 minutes to start with, looks at the open pull requests of the repository you name and reviews the ones the connected GitHub account has not reviewed at their newest commit. A language model reads each diff, and its findings are posted as a review comment pinned to the commit it read: **Looks ready** or **Changes suggested**, then what it found. A new push makes the pull request due again; until then, it is not reviewed again. It never approves, requests changes or merges; a person still does. It needs the GitHub connector, with a token that can read the repository's pull requests (through GitHub's GraphQL API) and comment on them.

| Question | What it decides |
| --- | --- |
| **GitHub account** | The connected account that reads and comments; its own reviews are the ones it counts. |
| **Pull requests per run** | How many one run reviews, 5 to start with, at most 10; the others wait for the next run, the one unchanged longest first. |
| **Diff size read, in characters** | Where a long diff is cut, 30,000 to start with; the review then says what it did not read. |

Drafts and the account's own pull requests are left out. A pull request whose diff GitHub declines to render because it is too large gets a short note instead of a review. A pull request whose diff could not be read, or whose review failed, is left for the next run, and the others are reviewed all the same; when every review of a run fails, the run fails. The run's output lists the pull requests it reviewed, the ones it left for the next run, how many more are waiting, and how many it skipped as drafts, its own, or already reviewed. Check its [execution log](/platform/automations/execution-logs) after the first live run.

## Tasks

### Triage new tasks {#triage-new-tasks}

Each time a task is created in the project you pick, a language model reads its title and description and comments a suggested priority, why, and a first concrete step, in the task's language. Nothing else on the task changes.

### Answer questions from your documents {#answer-questions}

When a task is created in the project you pick and its title ends with a question mark, it searches the organization's documents and comments an answer drawn only from what it found, naming its sources, or says plainly that the documents do not answer it. Other new tasks are left alone.

## Notifications

Messages from these templates and from [Summarize the inbox](#inbox-summary) arrive in the member's notifications, and by email when their settings send one; [Notify members](/platform/automations/notify-members) explains who is skipped.

### Daily task digest {#task-digest}

On its schedule — every day at 09:00 in your time zone, unless you change it — lists the tasks created in the project you pick since the last digest that was sent, and sends them to the member you choose as one message, a line each, with a link to the project's tasks. The first digest looks back one day. Each digest starts where the last one that succeeded ended, so a schedule moved to another hour, a digest that failed, or days the server was down never skip a task or list one twice. The tasks come oldest first, 50 at most: after a busy stretch the digest ends with …, and the next one carries on behind its last task. A digest without new tasks sends nothing.

### Tell the reviewer {#notify-reviewer}

When a task of the project you pick moves to **In review**, it tells the member you choose, with the task's title and a link to it. Other status changes send nothing.

## Webhooks

### Create tasks from a webhook {#webhook-create-task}

Another system — a form, a monitoring alert, a shop — sends JSON to the webhook address the automation's **General** tab shows, and a task is created in the project you pick: `title` names it and `description` adds its text. A delivery without a title is refused and creates nothing.

Each task is keyed by its delivery: the value of the field **Delivery key** names — `id` to start with, or a nested field such as `alert.id` — or, for a delivery without that field, its whole body. A delivery whose key was seen before updates the title of the task it made instead of adding a second one, also days later, when the webhook address no longer remembers the delivery itself; a description the task already has stays. **Sender name** (`webhook` to start with) keeps two senders whose keys could collide apart: give each its own.
