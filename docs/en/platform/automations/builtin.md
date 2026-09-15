---
title: Built-in automations
description: Choose a shipped mail or GitHub workflow, check its inputs and connections, and understand what it reads or writes before deployment.
---

Tale includes eight automation packages: three mailbox syncs, three inbox digests, and two GitHub workflows. Each starts as version 1 with a schedule and **Not deployed**. Use them as starting points: inspect their inputs, model, connections, and writes before an Owner, Admin, or Developer deploys a version.

<Frame caption="The Automations catalog shows package names, version counts, and deployment status.">

![The Automations catalog lists GitHub and mail packages with one version and Not deployed status.](/images/platform/automations-catalog.webp)

</Frame>

## Start with one package

Open **Automations**, select a package, and inspect its nodes in the [workflow editor](/platform/automations/editor). Check that the required connector is connected and that the model used by any `llm` node is available. A test run uses mock responses; it validates the flow without proving access to your real mailbox or repository.

The packages are added when an organization is created. Existing versions are preserved when the shipped package changes; only its shipped name and description refresh. A deleted package stays deleted. Your edits create new versions, which you deploy separately.

## Sync mail into the Inbox

These workflows pull new messages into conversations every five minutes. Each declares the **Inbox** view: deploying one makes that view available in navigation and offers its connected mailbox in the compose form. Before deployment, the Inbox page points to **Automations**.

| Automation | Required connector | Schedule |
| --- | --- | --- |
| Sync Gmail emails | Gmail | Every 5 minutes |
| Sync Outlook emails | Outlook | Every 5 minutes |
| Sync emails via SMTP/IMAP | IMAP/SMTP | Every 5 minutes |

Connect the matching mailbox first. After the first live run, inspect its [execution log](/platform/automations/execution-logs) and check that the expected messages appear in Inbox.

## Read a digest of recent mail

These workflows read recent messages from every connected mailbox of their kind every six hours. They return a summary and identify messages that appear to need a reply today. The digest is the run’s output: open the run to read it. They do not write back to the mailbox or change conversation status.

| Automation | Required connector | Schedule |
| --- | --- | --- |
| Triage the Gmail inbox | Gmail | Every 6 hours |
| Triage the Outlook inbox | Outlook | Every 6 hours |
| Triage the IMAP inbox | IMAP/SMTP | Every 6 hours |

## Review GitHub work

**Triage GitHub issues** reads open issues, scores whether they are actionable and their priority, and returns a ranked shortlist with reasons. It does not write to GitHub or create project tasks. Its default limit is 50 issues per run.

**Review GitHub pull requests** reads open pull-request diffs and posts findings as review comments. Its default limit is 10 pull requests per run. It does not approve or merge a pull request. Review the target repository before running it live, because a repeat run can add another comment.

| Automation | Required connector | Shipped schedule | Writes |
| --- | --- | --- | --- |
| Triage GitHub issues | GitHub | Daily at 07:00 UTC | None; read the run output |
| Review GitHub pull requests | GitHub | Every 30 minutes | A review comment per processed pull request |

Both workflows require `owner` and `repo`. In **Test run**, supply **Run input (JSON)** using your repository’s values:

```json
{
  "owner": "your-organization",
  "repo": "your-repository",
  "limit": 5
}
```

<Note>

The shipped GitHub schedules do not supply `owner` and `repo`; deploying alone does not make those scheduled runs valid. A schedule sends only `trigger` and `firedAt`, so the required repository input is missing and the start is refused. Run manually with the required input, or adapt the workflow’s schema and repository configuration before enabling scheduled execution. A refused scheduled start appears as `start_refused` on the [trigger](/platform/automations/triggers).

</Note>

Before deploying, read the resolved input and output of the test run. For a live run, also check connector permissions and any approval requirements. [Execution logs](/platform/automations/execution-logs) explains waiting, failure, and the recorded writes.
