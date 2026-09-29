---
title: Built-in automations
description: Choose a shipped mail, GitHub or GlitchTip workflow, check its inputs and connections, and understand what it reads or writes before deployment.
---

Tale includes ten automation packages: three mailbox syncs, three inbox digests, two GitHub review workflows, and GitHub and GlitchTip issue imports. Each starts as version 1 and **Not deployed**. The issue importers run manually; the other packages include schedules. Inspect their inputs, model, connections, and writes before an Owner, Admin, or Developer deploys a version.

<Frame caption="The Automations catalog shows package names, version counts, and deployment status.">

![The Automations catalog lists GitHub and mail packages with one version and Not deployed status.](/images/platform/automations-catalog.webp)

</Frame>

## Start with one package

Open **Automations**, select a package, and inspect its nodes in the [workflow editor](/platform/automations/editor). Check that the required connector is connected and that the model used by any `llm` node is one your organization serves — the packages name a model your providers may not offer, and validation warns about it when you save; pick a served model in the node’s **Model** field before a live run. A test run uses mock responses; it validates the flow without proving access to your real mailbox or repository.

The packages are added when an organization is created. Existing versions are preserved when the shipped package changes; only its shipped name and description refresh. A deleted package stays deleted. Your edits create new versions, which you deploy separately.

## Sync mail into the Inbox

These workflows pull new messages into conversations every five minutes. Each declares the **Inbox** view: deploying one adds that view to [Home](/platform#home) and offers its connected mailbox in the compose form. Before deployment, Home has no **Inbox** view. A link to the inbox shows a setup notice instead: for Owners, Admins, and Developers it points to **Automations**; everyone else is told that one of those roles must deploy an email automation.

| Automation | Required connector | Schedule |
| --- | --- | --- |
| Sync Gmail emails | Gmail | Every 5 minutes |
| Sync Outlook emails | Outlook | Every 5 minutes |
| Sync emails via SMTP/IMAP | IMAP/SMTP | Every 5 minutes |

Connect the matching mailbox first. After the first live run, inspect its [execution log](/platform/automations/execution-logs) and check that the expected messages appear in the **Inbox** view in Home.

## Read a digest of recent mail

These workflows read recent messages from every connected mailbox of their kind every six hours. They return a summary and identify messages that appear to need a reply today. The digest is the run’s output: open the run to read it. They do not write back to the mailbox or change conversation status.

| Automation | Required connector | Schedule |
| --- | --- | --- |
| Triage the Gmail inbox | Gmail | Every 6 hours |
| Triage the Outlook inbox | Outlook | Every 6 hours |
| Triage the IMAP inbox | IMAP/SMTP | Every 6 hours |

## Import and synchronize issues

**Import GitHub issues** and **Import GlitchTip issues** use the same form to turn source issues into tasks. They start without a schedule. These imports read the source and write Tale tasks; they never comment on, close, or change the upstream issue and do not start an agent.

1. Connect the source under **Settings > Connectors** and choose its default credential. GitHub needs repository access with read permission for issues. GlitchTip needs its instance URL and a token with `project:read` and `event:read`; a project-provisioning token alone cannot read issues. Self-hosted instances must be allowed by the deployment's connector host policy.
2. Open the importer and choose **Test run**. Select the **Tale project**, then enter the GitHub owner and repository or the GlitchTip organization and project slugs. Optional labels or a GlitchTip search narrow new issue discovery. **Maximum issues** accepts 1–500, defaulting to 100.
3. Inspect the test result, deploy the version, and choose **Run live** with the same destination and filters. A test run uses fixtures and creates no tasks; only a live run verifies the real connection.
4. Open **Runs** and select the run. **Imported tasks** links to the corresponding Tale tasks. If another batch remains, **Continue import** carries the same source, destination, and continuation position into the next run.

Each synchronization discovers new issues and refreshes up to 500 linked issues, prioritizing the oldest checks. Linked issues are refreshed even when they no longer match the discovery filter. Run again to keep large collections current. GitHub pull requests are excluded. Repeating or retrying an import reuses the same source identity within a Tale project; repository and project renames update the canonical source link instead of creating a second task. Issues moved to another repository or source project remain linked and continue to refresh through earlier imports, provided the connection can read their new location.

A task's source card shows the latest source title, description and status separately. When it imports an issue, Tale cuts a title over 200 UTF-16 code units or a description over 20,000 (most emoji count as 2) to that length on the task, ending it in "…"; the source card and the linked issue keep the full text. Closing or resolving a source issue leaves the Tale task's status, title, description, assignee and priority unchanged. A source issue that becomes unavailable retains its last known snapshot; authentication and rate-limit errors fail the run rather than declaring the issue deleted. Review and complete work in Tale as usual.

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
