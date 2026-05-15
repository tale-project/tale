---
title: Agent versions
description: Iterate on a live agent safely — every save lands in History, and any past snapshot can be compared against the current state and restored in one click.
---

Tale's agents save automatically as you edit them, and every save lands in a per-agent History list. The instructions, knowledge filters, tools, model preset, starters, and delegation targets all snapshot together — restore a past snapshot and the whole bundle comes back atomically. This page covers the iteration loop: what a History entry contains, how to compare two snapshots, and when restore is the right move.

The mental model behind the four knobs you're iterating on lives at [Agent concepts](/platform/agents/concepts); the build flow that produces those snapshots is at [Create an agent](/platform/agents/create).

## How saves and snapshots work

Edits to an agent's configuration save automatically — a status pill in the editor's top-right shows the current state (saving, saved). Each save creates a History entry that captures the full agent configuration at that moment: instructions, model picker, knowledge scope, tool toggles, conversation starters, delegation targets. No partial saves, no half-states; if the save succeeded, the entry is complete.

Live conversations continue against the agent state as it was when the message started — nobody sees a mid-turn personality change because someone saved a new edit in the middle of an answer.

## Open History

To browse the snapshots, open the **History** menu in the agent editor. The list shows every snapshot with the actor and the date, newest first. Each row is one save; you can hover for a tooltip preview or open the diff dialog to compare a snapshot against the current state.

If the list is empty, the agent hasn't been edited since it was created — the first save creates the first History entry.

## Compare two snapshots

Click a History entry to open the **Compare changes** dialog. The view shows the current state on one side and the snapshot on the other, with the differences highlighted at the field level. Use it to spot what a teammate changed in last Wednesday's save, or to verify a specific instruction wording before reverting to it. If the snapshot is identical to the current state, the dialog reads _No differences found_ and the **Restore this version** button is disabled.

## Restore a previous snapshot

To roll the agent back to a past snapshot, open it in the diff dialog and click **Restore this version**. The restore is destructive on the current configuration — Tale doesn't snapshot the current state before applying the restore, so save first if you want to keep your in-progress edits. The restore takes effect immediately for all new conversations; in-flight replies finish against their original state.

Use restore when a recent edit started producing worse answers — wrong tone, missing scope, broken tool access — and you want to back out without picking the changes apart. For incremental rollback (only revert the instructions, keep the new tool), open the snapshot for reference and copy the field you want into the current editor instead of running a full restore.

## File-based agents

Agents defined as JSON files in `TALE_CONFIG_DIR/agents/*.json` carry their version history in your git repository rather than the in-product History list. Edit the file, commit the change, and the platform picks up the new configuration on next sync. The History UI in the editor still shows snapshots captured by the platform when the file was last touched, but for file-based agents the source of truth is the repo. See [AI-assisted development](/develop/ai-assisted-development) for the file-based workflow.

## Where this fits

History is the iteration safety net for agents. The one thing to remember: every save creates a snapshot, so rewriting an agent's instructions is safe — if the new version produces worse answers, the previous one is one click away. Use the diff dialog for every meaningful change to confirm the snapshot captures what you expected; reach for restore when a recent edit started producing worse output and you want the previous state back wholesale.

For the build flow itself — naming, model picker, instructions, knowledge, tools — go back to [Create an agent](/platform/agents/create). For the mental model behind the four knobs you're tuning, [Agent concepts](/platform/agents/concepts).
