---
title: Agents and models in a project
description: The Agents & models tab curates which agents and models members see inside a project — Recommended pins favourites to the top, Restricted allows nothing else.
---

A project's **Agents & models** tab decides which agents and models members meet when they chat inside the project. It does not create new agents — agents are built org-wide under [Agents](/platform/agents/concepts) — it curates the existing catalog for this project's context, so a member opening the picker sees the right tools for the work first.

<Frame caption="The Agents & models tab — one Recommended/Restricted choice for agents, one for models.">

![The Agents & models tab of a project showing two radio groups, Agents and Models, each offering a Recommended mode and a Restricted mode with an Add button.](/images/platform/project-agents-models.webp)

</Frame>

## The two modes

Agents and models are curated separately, each with the same two modes:

- **Recommended** — the items you list are pinned to the top of the picker; everything else the member could normally use stays available below. This is the default, and the right mode for steering without blocking.
- **Restricted** — only the items you list are available in this project. Members picking anything else get a clear refusal: the chat reports that the agent or model isn't available in this project and asks them to pick another.

The list order is the order members see, and the first item is the default — drag to reorder. **Add agent** and **Add model** extend the list.

<Warning>

In **Restricted** mode an empty list locks every member out of chatting in the project — there is nothing left to pick. Add at least one item before saving, or switch back to **Recommended**.

</Warning>

## What members experience

Inside the project, the chat's agent picker and model picker reflect the curation — recommended items first, restricted items only. A chat moved into the project with a now-disallowed agent doesn't break silently: the send is refused with the agent-not-available message, and the member picks an allowed one. Outside the project nothing changes; curation is scoped to chats that run in the project's context.

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

This tab is project-side curation of an org-side catalog: building agents, their instructions, and their knowledge is the [Agents](/platform/agents/concepts) section's job; deciding which of them this project surfaces is yours. For how the picker behaves inside a chat, see [Agents in chat](/platform/chat/agents-in-chat).
