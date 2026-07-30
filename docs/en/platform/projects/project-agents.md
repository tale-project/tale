---
title: Agents and models in a project
description: The Agents & models tab curates which agents and models members see inside a project — Recommended pins favourites to the top, Restricted allows nothing else.
---

A project's **Agents & models** tab decides which agents and models the project's work is offered. It does not create new agents — agents are built org-wide under [Agents](/platform/agents/concepts) — it curates the existing catalog for this project's context, so a member assigning work meets the right tools first.

<Frame caption="The Agents & models tab — one Recommended/Restricted choice for agents, one for models.">

![The Agents & models tab of a project showing two radio groups, Agents and Models, each offering a Recommended mode and a Restricted mode with an Add button.](/images/platform/project-agents-models.webp)

</Frame>

## The two modes

Agents and models are curated separately, each with the same two modes:

- **Recommended** — the items you list are pinned to the top of the project's roster; everything else the member could normally use stays available below. This is the default, and the right mode for steering without blocking.
- **Restricted** — only the items you list are available in this project; everything else is refused with a clear not-available-in-this-project message.

The list order is the order members see, and the first item is the default — drag to reorder. **Add agent** and **Add model** extend the list.

<Warning>

In **Restricted** mode an empty list leaves the project with nothing to offer — there is nothing left to pick. Add at least one item before saving, or switch back to **Recommended**.

</Warning>

## What members experience

The curation shapes the project's roster — recommended items first, restricted items hidden. Chat itself always runs the built-in assistant, so the curation matters where agents actually work: the tasks and automations that run inside this project. Outside the project nothing changes.

## Who can change it

Editing the tab follows org roles: an editor or admin role is required to save changes, and members without it see the project read-only, with a banner pointing them at a project editor. Changes land on **Save** in the tab strip — the same unified Save/Discard cluster the General and Instructions tabs use.

## When to reach for each mode

| Use … when                                            | Recommended | Restricted |
| ----------------------------------------------------- | ----------- | ---------- |
| You want the right agent to be the obvious first pick | ✓           |            |
| Members should keep access to the full catalog        | ✓           |            |
| Compliance or cost demands a fixed, short list        |             | ✓          |
| An expensive model must not be used for this work     |             | ✓          |

## Where this fits

This tab is project-side curation of an org-side catalog: building agents, their instructions, and their knowledge is the [Agents](/platform/agents/concepts) section's job; deciding which of them this project surfaces is yours. Chat itself runs the built-in assistant only — these agents do their work on tasks and automations inside the project.
