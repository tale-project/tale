---
title: Notify members from an automation
description: Tell members something from an automation with the notify.member step — a title, words and a link, in their notifications and by email — and know who is skipped and what is refused.
---

Use a `notify.member` step when an automation should tell people something: a report is ready, three invoices need a look, an import finished. Each member it names gets the message in their notifications and by email, in a frame that names the automation. A live run sends it; a test run answers with a mock and tells nobody.

## Send a message

```yaml
nodes:
  - id: tell
    type: notify.member
    input:
      to: [ada@example.com, '{{ input.ownerId }}', run-starter]
      title: Weekly report ready
      message: '{{ nodes.summary.output.text }}'
      link: '{{ nodes.report.output.url }}'
```

| Input     | What it holds                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `to`      | Up to 20 members, by email or user id, or `run-starter` for the person who started the run.                                                                                               |
| `title`   | What the message is about, in one line of at most 120 characters. It heads the notification and is the email's subject.                                                                   |
| `message` | The words below the title, as plain text, at most 2,000 characters.                                                                                                                       |
| `link`    | A page of your organization, as its path starting with `/dashboard/`, or an `https://` address. A page opens in Tale; an address opens in a new tab, and the notification names its site. |

A blank `message` or `link` — a template that found nothing — is left out.

The step returns `{ delivered, skipped }`: `delivered` lists each member it reached as `{ to, userId }`, under the name the step gave them, and `skipped` lists `{ to, userId, reason }` for each one it did not.

<Frame caption="A live run of Announce the weekly report: the step read the week from the run's input, and told the person who started the run.">

![The page of a succeeded live run of Announce the weekly report with its Tell step selected, a Notify · Notify members step. Its Last run tab says it ran notify.member and read week from the run input; under Received are its to, a list of 1 item, its link to reports.example.com, its title Weekly report ready and its message. Below the canvas the run lists 1 effect.](/images/platform/automation-notify-run.webp)

</Frame>

## Who gets it

Each member gets one notification, even when the step names them twice — by email and by user id. The email follows a minute later, unless they read the message in Tale by then or switched off **Email me actionable alerts** in Settings › Notifications. It leaves through your organization's connected Gmail, Outlook or SMTP mailbox; without one, they get the notification in Tale only.

<Frame caption="The message in the notifications of the person who started the run: its title, its words, the automation that sent it, and the site its link opens.">

![The Notifications panel with 1 unread notification: the title Weekly report ready, the message about week 41, the line Sent by the automation Announce the weekly report, and below them Open reports.example.com with an icon for a new tab.](/images/platform/automation-notify-bell.webp)

</Frame>

Two kinds of recipient are skipped, and listed in `skipped` with their reason:

| Reason       | Why                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `preference` | They switched off **Messages from automations** in Settings › Notifications.                    |
| `no_starter` | `run-starter` on a run no person started: a trigger started it, or the person who did has left. |

## Once each time the step runs

The step sends its message once each time it runs: once per run, and once per item or pass in a loop. When a run is interrupted after the message went out and resumes, the step tells nobody twice and answers with the members it already reached.

One run sends at most 100 messages, so a step in a loop can't flood people's notifications. To tell someone about many items, send one message that lists them.

## When a step fails

| Failure                            | What happened                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **A recipient isn't a member**     | Someone the step names isn't a member of the organization, or their membership is disabled. Nobody is told. |
| **The run sent too many messages** | The step would have taken the run past 100 messages. It sent nothing.                                       |

A link that is neither a page of your organization nor an `https://` address fails the step before anything is sent.
