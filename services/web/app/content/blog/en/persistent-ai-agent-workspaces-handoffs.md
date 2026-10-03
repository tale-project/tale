---
title: "Help an AI agent pick up where work stopped"
description: "Write a handoff that lets the next AI session continue the right work. Keep useful files, identify changed assumptions, and name the next action."
slug: persistent-ai-agent-workspaces-handoffs
topicId: T04
reviewed: '2026-10-03'
draft: false
coverAlt: "A dossier crosses a blue bridge between two separate work trays."
---

To help an agent continue a previous session, save more than the conversation. Leave the current goal, the files it should use, what is finished, what remains uncertain, and the next useful action. Ask the next session to verify that record before continuing.

Persistent files prevent work from disappearing. They do not tell the next agent whether yesterday's conclusion still answers today's question. A short handoff makes that difference visible.

## Check what the next session can actually access

Before stopping, put the work somewhere the next session or agent can open. Name the exact file versions. Keep the current task brief alongside them, especially if instructions changed during the work.

Files, task comments, conversation history, and the material currently available to the model are different things. A saved report can survive even when a conversation starts fresh. A preserved conversation can still contain an outdated brief. Do not use “it remembers” as the only handoff plan.

In Tale, project agents reuse a persistent workspace, but conversation continuation depends on the runtime. Gemini CLI starts a fresh conversation over the retained workspace. Check the [runtime guide](https://docs.tale.dev/platform/agents/harnesses) for the path you use.

![Project references, task records, files, conversation history, and active model context provide different parts of continuity. An explicit handoff tells the next agent what to verify and use.](/blog/diagrams/en/T04-diagram.svg)

If you are handing work to a different agent, verify access rather than assuming it shares the first agent's workspace. Attach or link the required material through the shared project. A file path in someone else's private directory is not a usable handoff.

## Leave a handoff that changes the next action

Consider an illustrative supplier comparison. Brief B2 asked for tools for five people. The first session produced a source register, feature notes, and a recommendation. The project owner then issued B3: the team will have 50 people, and single sign-on is required.

“Supplier A looks best; finish the report” would send the next agent in the wrong direction. The useful handoff says which previous work still holds:

| Handoff field | Filled example |
| --- | --- |
| Current goal | Compare the existing candidates for 50 people with required single sign-on, using brief B3 |
| Files to open | Brief B3, source register r4, feature notes for A and B, recommendation r2; attach the actual files or accessible links |
| Work to keep | Source register and feature notes as starting material, with their references |
| Work that no longer answers the brief | Recommendation r2 and the five-person cost estimate were prepared under B2 |
| Missing evidence | Which plans provide the required single sign-on, and what they cost for 50 people |
| Next action | Check plan and feature sources for the existing candidates, then recalculate cost and reconsider the recommendation |
| Stop and ask | A required source is inaccessible or does not establish whether a candidate qualifies |

This record saves the next agent from repeating the whole search. It also stops it from polishing a recommendation that is no longer supported. More suppliers become relevant if the existing candidates fail B3; there is no need to expand the list before checking them.

You can adapt the [handoff worksheet](/blog/worksheets/en/T04-handoff.md) for your own project. For a small task, the filled example above may be all the structure you need.

## Verify the handoff before resuming

Give the next session the handoff and this instruction:

> Read the current task brief and open the listed files. Tell me what remains usable, what needs rechecking, and your first action. If the handoff conflicts with the current brief, flag the difference before continuing.

In the example, the first useful response identifies B3 as current, sets aside the old recommendation, and checks single sign-on and plan terms. It should not erase the old research or treat every saved claim as current.

Recheck the conclusions affected by the change. A five-person price calculation needs replacing; a dated note about a past customer interview may still be useful as historical evidence. If the old report lacks source references, a broader review may be necessary because the next agent cannot tell which assumptions support which claims.

Also confirm what “finished” means. A file named `final.md` may still be an unreviewed draft. Record whether the work is proposed, checked, or accepted so the next session does not turn a working file into an approved conclusion.

## Record uncertain actions before retrying them

There is one extra question when the previous session could change an external system: did an attempted action take effect?

If it tried to create a ticket and lost the response, write “ticket creation unconfirmed,” with the request identifier and destination. Check the receiving system before trying again. Missing confirmation is not proof that nothing happened.

For a read-only research task, simply record that no external writes were attempted. Keep the handoff short enough to use. It has done its job when the next agent can open the right material, reject an outdated assumption, and take the next useful step without asking you to reconstruct the previous session.
