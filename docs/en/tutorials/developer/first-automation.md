---
title: "Your first automation: a daily task digest"
description: Create an automation from the Daily task digest template, run it once by hand, and find the digest it sent in your notifications.
---

In this tutorial you create an automation from a template, run it once and read what it sent. The **Daily task digest** lists the tasks created in a project during the last day and sends them to a member every morning; you set it up for one of your projects and send it to yourself.

You need the Owner, Admin or Developer role, and a project you can open with at least one task created in the last 24 hours. If it has none, add one on the project's board first.

## Create the automation

1. Open **Automations** and select **Create automation** › **From a template**. While your organization has no automation, select **Browse templates** instead.
2. Select **Daily task digest**; the **Notifications** tab narrows the catalog to it and its neighbours. Its preview says what it does and when it runs.
3. Select **Use this template**.
4. Under **Project**, pick your project. Under **Send to**, pick yourself.
5. Leave **When** at every day at 09:00 in your time zone, and leave **Start it now** on.
6. Select **Create automation**.

The automation opens in the editor. Its version 1 is live, and its schedule is on.

## Run it once now

You don't have to wait for 09:00. In the editor's header, select **Run live**, then **Run live** again to confirm. The run lists the project's tasks of the last 24 hours and sends you the digest.

Open **Runs** to follow it. Once the run says **Succeeded**, select it, then its **Tasks** step: **Returned** lists the tasks it read.

<Frame caption="The run, with its Tasks step selected: the tasks it read, oldest first.">

![The page of a succeeded live run of Daily task digest with its Tasks step selected, a Tasks · List tasks step; under Returned is a list of 7 tasks.](/images/platform/automation-task-list-run.webp)

</Frame>

## Read the digest

Open your notifications. The digest arrives as **New tasks**: a line for each task with its number, title and assignee, followed by the line **Sent by the automation** and its name. Select it to open the project's tasks.

A day without new tasks sends nothing, and the run still succeeds.

## Next

- Change when it runs on the **General** tab, under **Trigger**.
- See what the other templates do in [Automation templates](/platform/automations/templates).
- Change its steps in the [editor](/platform/automations/editor); [Add tasks from an automation](/platform/automations/add-tasks) explains the `task.list` step it uses.
