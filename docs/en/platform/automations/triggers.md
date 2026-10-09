---
title: Start automations automatically
description: Run an automation on a schedule, from a webhook or on a platform event, check what each run receives, and find out why a start was skipped.
---

Use the **Trigger** section on the automation’s **General** tab when work should start on a schedule, when another system sends a request, or when something happens in Tale. Every trigger starts the deployed version in live mode. Before you turn one on, check what its runs will receive and that the workflow’s external actions are ready.

<Frame caption="A shipped package’s trigger arrives switched off: its schedule is set and its next runs are listed, but nothing starts until you turn it on.">

![The General tab of Triage the Gmail inbox with Enabled switched off, Schedule as the trigger type, the Repeat format with a schedule of every 6 hours, the UTC timezone, Start the latest one when Tale is back under Missed runs, and the next runs listed under Would run at.](/images/platform/automation-general-trigger.webp)

</Frame>

## Choose how the automation starts

| Trigger type | Use it for | Input passed to the run |
| --- | --- | --- |
| **Schedule** | Periodic work at local times of day or at a regular interval. | `{ trigger: "schedule", firedAt: <epoch ms> }` |
| **Webhook** | A delivery from another system. | `{ trigger: "webhook", payload: … }` |
| **Platform event** | Something that happens in the organization, such as a new task. | `{ trigger: "event", event: "…", payload: … }` |

Every type can also add a [fixed input](#fixed-input): values each run receives beside these fields, such as the repository a scheduled triage reads.

An automation has one configured trigger at a time. Changing its type replaces the previous binding. Replacing a webhook revokes its URL immediately; configuring another webhook later does not recover that credential.

An API or MCP client can also start work without a configured trigger. Its API key and project permissions authorize the request, and it sends the workflow’s input directly. See the [API reference](/develop/api-reference).

## Set a schedule

<Steps>

<Step title="Open the trigger settings">

Open the automation, then its **General** tab. Without a binding, the **Trigger** section says that the automation runs only when started by hand or through the API. Choose **Add trigger**. A new trigger is a **Schedule** that runs daily at 9:00 in your time zone, with **Enabled** switched off. Keep it off while you prepare a workflow that should not start yet.

</Step>

<Step title="Pick a repeat">

Leave **Schedule format** on **Repeat** and open **Schedule**. The presets are **Every 15 minutes**, **Every hour**, and daily, weekday, weekly and monthly runs at a time of day. The weekly and monthly presets use today’s weekday and day of the month, and every preset with a time keeps the schedule’s earliest time. Choosing a preset closes the popover and puts it in the form. Under the presets and the custom views, the popover lists the next three runs of the schedule you are building.

</Step>

<Step title="Or build your own">

Choose **Custom times** to run at times of day: pick **Day**, **Week**, **Month** or **Year**, the interval (for example every 2 weeks), the weekdays or the day, and up to 12 times under **At**. **Add time** adds a time one hour after the last one. A time that is already in the list runs once, and saving sorts the times.

Choose **Custom interval** to start every few minutes or hours: up to every 30 minutes in steps that divide an hour, or up to every 12 hours in steps that divide a day, at a number of minutes past the hour. Keep the weekdays it should run on and, with **Only between**, limit it to the hours between two times. Under the hours, the picker names the day’s first and last run.

**Save**, Enter or Ctrl+Enter (Cmd+Enter on a Mac) applies the custom schedule; **Cancel** or Escape discards it.

</Step>

<Step title="Choose the timezone">

**Timezone** is the zone the schedule’s times are read in. It starts as your own; search for another IANA zone such as `Europe/Zurich` when the work follows another office’s hours.

</Step>

<Step title="Read the next runs">

**Next runs** lists the next five starts in the schedule’s zone and, when your own zone is different, the same moment in your time zone. While you have unsaved changes the heading reads **Next runs (unsaved)**. While the trigger is off or no version is deployed, it reads **Would run at**, and the line below says what is missing.

</Step>

<Step title="Save and turn it on">

Click **Save** beside the tabs. Under [This run receives](#check-what-a-run-receives), check that the deployed version accepts the input. When you are ready, turn on **Enabled** and save again. The next started run appears under **Runs**, and the **Trigger** section shows it as the last run.

</Step>

</Steps>

**Custom interval** counts from local midnight, so every 2 hours at 15 minutes past the hour starts at 00:15, 02:15 and so on. **Only between** includes the start and stops before the end: from 8:00 until 18:00, every 15 minutes runs last at 17:45. An end earlier than the start runs overnight, and the hours after midnight belong to the day the window started, so Friday from 22:00 until 06:00 runs into Saturday morning but not on Saturday evening. An end of 00:00 runs until midnight, and the same start and end means all day. When no run would fall between the two times, for example every 6 hours from 8:00 until 11:00, the picker says so and **Save** waits until you widen the hours or shorten the interval.

### When the clocks change

A schedule keeps its local times through daylight-saving changes:

- A time the clock skips that day starts once, moved forward by the gap. In `Europe/Zurich`, a 02:30 run starts at 03:30 on 29 March 2026.
- A time the clock repeats starts once, the first time it occurs.
- **Every N minutes** and **Every N hours** keep their real-time spacing instead: they run twice in the hour the clock repeats, and not at all in the hour it skips.

**Next runs** marks a start that meets a change with **Clock change** and explains what happens.

### When runs are missed

**Missed runs** decides what a schedule does with the times it was due while Tale was unavailable, for example during an update:

| Choice | What happens when Tale is back |
| --- | --- |
| **Start the latest one when Tale is back** (default) | The most recent missed time runs once, however late. Earlier missed times are counted, not run. |
| **Skip them** | A run more than 10 minutes late does not start; it is counted as missed. |

For example, a schedule that runs daily at 09:00 misses its start while Tale is down from 08:30 to 10:15. With the default, a run starts at 10:15 for 09:00; with **Skip them**, nothing starts, and the **Trigger** section says that 1 run was missed. Whenever runs are counted as missed, the section says how many and between which times, counting up to 1,000. With the default, those are the times before the one that started, such as the earlier starts of an every-15-minutes schedule during the same outage. Time the schedule spent switched off or paused, and time before it was saved, is never counted as missed.

## Use a cron expression

Switch **Schedule format** to **Cron (advanced)** when you already have a cron expression or need a pattern that **Repeat** does not offer. A cron expression has five fields: minute, hour, day of month, month and day of week.

```text
*/15 * * * *     every fifteen minutes
0 9 * * 1-5      09:00 on weekdays
0 6 1 * *        06:00 on the first of the month
30 8 1 * 1       08:30 on the 1st and on every Monday
```

Fields support `*`, numbers, ranges, steps and comma-separated lists. Both 0 and 7 mean Sunday. If both day-of-month and weekday are restricted, either match is enough; the last example runs on Mondays as well as the first day of each month. When **Repeat** can say the same thing, the line under the field reads it back, such as “Reads as: Every weekday at 9:00 AM”. An expression that cannot be read, or one that names a date that never comes, such as `0 0 30 2 *`, shows why under the field; **Next runs** stays empty and **Save** waits until you correct it.

A cron expression follows the same daylight-saving rules: one whose minute and hour are numbers names times of day, and one whose minute or hour starts with `*` keeps its real-time spacing.

Switching between **Repeat** and **Cron (advanced)** converts the schedule when one says exactly what the other does. When it can’t, for example for a schedule at 9:00 and 17:30, the field says so, and both entries stay in the form until you save. A schedule saved earlier as a cron expression opens in **Repeat** when a repeat says exactly the same, with a note naming the stored expression. Saving it unchanged keeps the cron expression; saving a changed schedule stores it as a repeat. A cron expression that **Repeat** cannot express opens in **Cron (advanced)**.

## Receive a webhook

Choose **Webhook**, then save to create the URL. **Webhook URL — copy it now** shows it once: one URL for each project the automation is installed in, or one for the organization when it is installed in none. Copy each URL you need; the token at its end is stored only as a hash. After that, the section lists the addresses with the token hidden, under **Project URLs** or, for the organization, **Webhook endpoint**. **Rotate token** creates a new URL. An automation installed in projects runs only through a project URL.

**Send a test request** holds a ready `curl` command. Right after the URL is created, the command contains it; later, it reads the URL from `TALE_WEBHOOK_URL`, the variable to keep it in on the sending system. It sends a small JSON body with an `Idempotency-Key`. JSON arrives as `payload` inside the input wrapper, not as the workflow’s top-level input; other request bodies arrive as text. The limit is 256 KiB; upload large documents separately. An accepted request returns a run ID without waiting for the run to finish.

For example, a posted `{ "invoiceId": "inv-1" }` reaches the workflow as:

```json
{
  "trigger": "webhook",
  "payload": { "invoiceId": "inv-1" }
}
```

Send a delivery ID, such as `Idempotency-Key` or the sender’s supported delivery header. Repeating that ID within 24 hours returns the original run. Without an ID, an identical body on the same URL within two minutes is treated as a duplicate. Send distinct IDs if identical payloads represent separate work. [Webhooks](/develop/webhooks) lists supported headers, project routes, errors and response formats.

**Recent deliveries** lists the last ten runs the webhook started, newest first, with each run’s status and **View run**. While Tale still remembers a delivery, the row also says how it recognizes a repeat: **ID from** the header it read, or **No delivery ID**. A request Tale refused started no run and is not listed; the sender’s response says why.

<Warning>

The URL authorizes a run. Store it as a credential and share it only with the sending system. **Rotate token** asks for confirmation, then creates a replacement and invalidates the old URL; removing or replacing the trigger also revokes it. Update the sender after a rotation.

</Warning>

## React to a platform event

Choose **Platform event**, then pick the event under **Event name**. The list groups the events by what they concern and shows each one’s name, ID and when it is raised; type part of any of them to search. Save, and turn on **Enabled** when ready.

| Event | ID | Raised when | `payload` holds |
| --- | --- | --- | --- |
| **Task created** | `task.created` | A task is created on a board, through the API or by an import. | `taskId`, `projectId`, `actorType`, `actorId` |
| **Task status changed** | `task.status_changed` | A person moves a task to another status. An agent’s own moves don’t count. | `taskId`, `projectId`, `fromStatus`, `toStatus`, `actorType`, `actorId` |
| **Comment added** | `comment.created` | A comment is posted on a task. | `comment` with its `body`, `taskId`, `projectId` and `mentions` |
| **Mentioned in a comment** | `comment.mentioned` | A task comment mentions someone with @. | `comment`, `taskId`, `mentions`, `actorType`, `actorId` |
| **Conversation started** | `conversation.created` | A conversation opens in Inbox: an email arrives, or an external conversation is mirrored in. | `conversationId`, `channel` |
| **Message received** | `conversation.message_received` | A message lands on an existing conversation. | `conversationId`, `messageId`, `direction` |
| **Contact created** | `contact.created` | A contact is added through the API, the app or an import. | `contactId` |
| **Contact updated** | `contact.updated` | A contact’s details change. | `contactId` |
| **Contact deleted** | `contact.deleted` | A contact is deleted. | `contactId` |
| **Project created** | `project.created` | A project is created. | `projectId`, `name`, `actorId` |

The payload carries IDs, not whole records: read the task, comment or contact with a step when the workflow needs more. A new task, for example, reaches the workflow as:

```json
{
  "trigger": "event",
  "event": "task.created",
  "payload": {
    "taskId": "5e2f9d34-8a71-4c6b-b0d2-91a7e3c4f815",
    "projectId": "0b9c6a52-5d1e-4f0a-9c3e-2f6d8a1b7e40",
    "actorType": "user",
    "actorId": "c41d7e88-2b3a-4f95-8e60-7d5a9b1c0f23"
  }
}
```

Task, comment and project events belong to a project; contact and conversation events don’t. An event of a project starts the automations installed in that project and those installed in none, and their runs belong to that project. An automation installed only in other projects doesn’t react to it. An event without a project starts an automation installed in exactly one project in that project. When that project is archived, or the automation’s inputs refuse the event, no run starts and the trigger shows why. The other automations listening for the event still start. Under **Event name**, the field says which events start this automation.

An event that an automation’s run raises never starts that same automation, and a run that an event started doesn’t start other automations, so a workflow cannot keep starting itself, or another one, through its own changes.

## Check what a run receives

**This run receives** shows the input the next run gets, exactly as the trigger builds it: the trigger’s own fields, its fixed input and, for a webhook or an event, a sample `payload`. For a schedule, `firedAt` is the due time in milliseconds since 1970 (UTC). Use **Copy the input** to paste it into a test run.

Below it, the section compares the input with the deployed version’s inputs. It says **Version 3 accepts this input**, for example, or warns **Version 3 doesn’t accept this input** with a way to fix it: add the missing fields to the fixed input, or change the inputs in the editor. A webhook’s body is unknown until a request arrives, so it never counts against the version. Saving a trigger, and deploying a version, run the same check; the save goes through and names the problem.

### Fixed input

A fixed input adds the same values to every run the trigger starts, such as the `owner` and `repo` a scheduled GitHub triage needs. Open **Add fixed input** and enter a JSON object of up to 16 KiB. The trigger’s own fields (`trigger`, `firedAt`, `event` and `payload`) are set over it, so it cannot contain them. It is plain data: a template such as `{{ input.owner }}` arrives as text, and the save warns about it.

When the deployed version requires fields the trigger doesn’t send, the section is already open, and **Add the 2 missing fields** (or as many as are missing) writes a placeholder of the right type for each one and puts the cursor in the first. Replace the placeholders and save. A scheduled run then receives:

```json
{
  "owner": "acme",
  "repo": "website",
  "trigger": "schedule",
  "firedAt": 1791529200000
}
```

### Run now

**Run now** starts the deployed version once, for real, with the input the saved trigger sends, as the trigger would. For a schedule, it shows that input and asks you to confirm with **Start run**. For a webhook or an event, it opens the run dialog with the sample to edit. It waits for a deployed version and for your trigger changes to be saved. The result appears under the button: **Run started.** with **View run**, or the reason no run started. The schedule, and the trigger’s own last run, don’t change.

## Turn on the trigger after deploy

A new trigger starts switched off, and so does the trigger of a shipped package. When you deploy a version, in the editor or by uploading a package, and its trigger is off, a notice says **Its trigger is off**. **Turn on the trigger** switches on the saved trigger exactly as it is, and the notice then reads **The trigger is on.**

When the deployed version would refuse what the trigger sends, or a webhook has no URL yet, the notice offers **Review the trigger** instead. It opens the **Trigger** section on the **General** tab, where you can add the fixed input or create the URL first. The shipped GitHub packages are an example: their schedules need a repository, as [Built-in automations](/platform/automations/builtin) explains.

## Start a project agent on a schedule

A schedule can put one of a project's existing agents to work: a standing task the agent reports on at every occurrence, or recurring work you would otherwise start by hand. Install the automation in the task's project, add a `task.start_agent` step that names the task, and give the automation a schedule. Each occurrence starts the task's agent assignee, or first assigns the task to the agent `agentId` names, which must belong to the same project. `feedback` is the message the run addresses first, such as the occurrence it serves:

```yaml
nodes:
  - id: start
    type: task.start_agent
    input:
      taskId: <the task's ID>
      moveToInProgress: false
      feedback: 'Scheduled occurrence {{ input.firedAt }}.'
```

The step answers the run it started, and the task's timeline lists that run as **automation** with a link to the automation run. When it starts nothing, the step still succeeds and says why, so the occurrence is recorded rather than queued:

| Answer | Meaning |
| --- | --- |
| `started: true` | The agent's run started; `runId` names it. |
| `already_running` | The task's previous run is still working and carries the work. Nothing new starts, and the occurrence does not wait behind it. |
| `in_review` | With `moveToInProgress: false`, the card waits for its captured reviewer, a person or an agent. Nothing is assigned or started, and the review keeps that recipient. |
| `closed` | With `moveToInProgress: false`, the card is **Done** or **Cancelled** (`taskStatus`). Nothing is assigned or started. |
| `agent_busy` | The agent is working another task (`busyTaskId`). An agent works one task at a time in its workspace. |
| `blocked` | A task this one depends on is still open (`blockedBy`). |
| `paused` | The task took three starts by automations and agents within the last hour, ordinary automatic retries included. One broker cooldown immediately after the same agent’s HTTP 429 adds no start; consecutive cooldowns still count. `retryAfter` says when the hourly count permits another start; other admission checks still apply. |

A run a schedule starts answers to no person. It works with the agent's configured instructions, secrets and tools, and its spend counts as automation spend against the organization's limits. Connector actions it asks the platform to run act for nobody, so they are refused. It keeps that authority only while the schedule may act in the project: turning the schedule off, removing it, or uninstalling the automation from the project stops the next start, fails a run that has not launched yet, and ends the workspace tools of a run in progress. A run a person starts from the automation answers to that person instead, as long as they can edit the project. A run a webhook or a platform event started cannot start agents, and an automation that is not installed in the task's project cannot reach its agents.

`moveToInProgress` decides what happens to the card. By default the card moves to **In progress** and the result waits at **In review** for its [configured reviewer](/platform/projects/tasks#review-default), as after **Start agent**; a review still pending on the earlier work is withdrawn, never approved. With `false` the card stays where it is and the run asks for no review, which suits a standing task in **To do**. The run keeps that choice to its end: when it completes, its report and files arrive as usual, and the card is neither moved nor sent for review, even if someone moved it to **In progress** meanwhile. That start only runs under open work (**Backlog**, **To do** or **In progress**): a card waiting at **In review** answers `in_review` and a closed one `closed`, so the card never presents earlier work for judgment, or as finished, while new work runs under it.

A retryable failure can be retried automatically while the task keeps its original status and assignee, with no later status, assignment, archive or review decision. Changing a value and then changing it back still ends that retry; comments do not. The attempt limits, schedule permissions and workspace checks still apply. A later scheduled occurrence can start fresh work when eligible.

### Import every issue on a schedule

An issue import reads at most one batch per run, up to 500 issues, and answers where the next batch starts. A person continues it with **Continue import**; a schedule keeps the position between its occurrences instead, so each occurrence imports one batch from where the last one stopped until every open issue has been read, and the occurrence after that starts the next pass. Read the position with `task.get_import_cursor`, pass it to the importer, and save the importer's `nextCursor` with `task.save_import_cursor`:

```yaml
nodes:
  - id: position
    type: task.get_import_cursor
    onError: continue
    input: { projectId: <the project's ID>, externalSystem: github, source: owner/repo }
  - id: issues
    type: subautomation
    automation: github-import-issues
    onError: continue
    input:
      projectId: <the project's ID>
      owner: owner
      repo: repo
      limit: 500
      cursor: '{{ nodes.position.output.cursor }}'
  - id: progress
    type: task.save_import_cursor
    onError: continue
    input:
      projectId: <the project's ID>
      externalSystem: github
      source: owner/repo
      revision: '{{ nodes.position.output.revision }}'
      next: '{{ nodes.issues.output.nextCursor ?? "" }}'
```

`source` is your name for the listing; automations that name the same source share one pass. The read also answers `revision`, the position's compare token, and the save hands it back: the position advances only while it is still at that revision. Every saved batch, every drain and every restart moves the revision on, and a revision never repeats, even when the cursor text does. An import that fails saves nothing, so the next occurrence retries the same batch. A save from any earlier revision is refused (`conflict`) and writes nothing, whether it comes from an overlapping run, from a run delayed past the end of its pass, or from a run that still holds a position from before a restart. After three reads of one position without a save, the next read starts the pass over (`restarted`) instead of retrying a position the source keeps refusing, for example after the repository was renamed. The save answers `batch` and `drained`, which a receipt can report. Each run also refreshes up to 500 issues imported earlier, the longest-unchecked first, so a large collection is refreshed over several occurrences.

## Diagnose a missing start

The top of the **Trigger** section says how the trigger is doing: the time of the last run it started, with that run’s status and **View run**, or **Hasn’t started a run yet.** When the trigger last came due, or an event last arrived, and nothing started, a notice below it says why, with the fix and a way to get there:

| Notice | What happened | What to do |
| --- | --- | --- |
| **Skipped: no version is deployed** | The trigger came due, but only drafts exist. | **Open the editor** and deploy a tested version. |
| **Skipped: the run’s input was refused** | The deployed version refused what the trigger sends. | Add the missing fields to the [fixed input](#fixed-input), or change the inputs in the editor. |
| **Skipped: its project can’t start runs** | Its project is archived, missing, or no longer allows the automation. | **Edit the projects** under **Projects** below. |
| **Skipped: the run couldn’t start** | The start was refused for another reason. | Open **Technical details** to read the code and the message. |
| **Skipped: the schedule can’t be read** | The schedule or its time zone could not be read. Nothing starts until it is corrected. | **Edit the schedule** and save. |
| **3 runs were missed**, for example | Runs came due while Tale was unavailable. | Nothing; [Missed runs](#when-runs-are-missed) decided what started. |
| **Paused after repeated failures** | The schedule turned itself off. | See [When a schedule pauses itself](#when-a-schedule-pauses-itself). |

**Technical details**, closed at first, holds the raw facts in English: the code, the version that refused the start, its message and each problem with its field. When earlier runs were missed too, the notice says how many. The API reads the same facts as `lastSkipReason` and `lastSkipDetail`; see the [API reference](/develop/api-reference#check-trigger-health-and-pause-safely).

Some missing starts show no notice:

- A webhook request Tale refused started no run and moved nothing on the trigger. Check the sender’s response; [Webhooks](/develop/webhooks) lists the answers. An unknown or switched-off URL gets the same refusal on purpose.
- A run that exists but did not finish started fine. Open it from **Runs**; [execution logs](/platform/automations/execution-logs) explain what happened inside it.

The last run moves only when a run actually starts. A trigger that comes due and cannot start one records the skip instead, which separates a broken trigger from a workflow that started and later failed.

## When a schedule pauses itself

A schedule whose runs fail the same way at every occurrence would otherwise keep failing indefinitely. Tale counts the runs a trigger starts that fail with an error a retry won't fix: the automation's own code (`node_error`), a connector (`connector_error`), a model reply that does not match its schema (`llm_output_invalid`), or the organization's model provider (`auth_error`, `missing_api_key`, `credit_exhausted`, `model_not_found`). A successful run resets the count, and other failures, such as a rate limit or an unreachable provider, neither count nor reset it. A schedule that has already paused itself is the exception: it keeps the count that paused it, even when a run that was still in progress succeeds afterwards, and only saving the trigger clears it.

After five such failures in a row, the schedule turns **Enabled** off and records `paused_after_failures`. The **Trigger** section then shows the pause, the last failure's code and time, and **View run**, which opens that run. While runs are failing but the schedule is still on, the section shows how many failed in a row. Owners and Admins get a bell notification, which also reaches them by email when the organization has a connected mailbox, and the audit log records the pause. They can switch these notices off with **Automation alerts** under **Settings > Notifications**.

Open the failed run to read the error, and fix the automation or its connection. Then turn on **Enabled** and save. Saving the trigger starts a new count, whether it turns the schedule back on or leaves it off, and marks the notices read.

Webhook and platform-event triggers count failures the same way but are never paused. Their runs carry a delivery or an event, which a paused trigger would drop.

## Pause or replace the trigger

Turn off **Enabled** and save to pause starts while retaining the configuration and run history. Re-enable it to resume. **Remove trigger** deletes the binding; for a webhook, its URL becomes unusable.

Triggers belong to the automation’s name, not a version. Deploying or rolling back keeps the same schedule or URL and changes which version future starts execute. Editing a trigger does not create a workflow version, so review trigger settings alongside any deployment that changes expected inputs.
