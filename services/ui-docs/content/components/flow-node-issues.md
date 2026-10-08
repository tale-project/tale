---
title: Flow node issues
description: Mark the nodes of a flow canvas with their problem counts, in a way that reads without colour or sight.
---

A canvas shows where problems are before anyone opens a list. `FlowNodeIssueMarker` puts an error count and a warning count on a node's face, and two helpers give the node the matching frame colour and words for its accessible name.

```tsx
import {
  FlowNodeIssueMarker,
  flowNodeIssueFrameClass,
  flowNodeIssueText,
} from '@tale/ui/flow/node-issue-marker';
```

## Mark a node

<Demo name="flow/node-issues" />

**Draft reply** has two errors and a warning, **Triage** one warning, and **Send reply** none, so it shows no marker. Choose a node to see that the selection ring and the problem frame stay distinct.

Render `FlowNodeIssueMarker` with `errors` and `warnings` inside the node's own button, beside its type badge. It renders nothing when both are zero. The chips are 20px tall: a red chip with a crossed circle for errors and an amber one with a triangle for warnings. Their colours come from `ISSUE_SEVERITY_CHIP_CLASS`, and the count keeps at least 4.5:1 contrast on its tint, on a card and on the page, in both themes. They fade in when they appear and show at once under reduced motion.

## Make the node say it

The marker is `aria-hidden` decoration and is never a control, because the node is already a button and a control may not sit inside another. Put the counts into the node's name instead: append `flowNodeIssueText(t, counts)` to the button's text as visually hidden content. It returns "(2 errors and 1 warning)" in the session's language, or an empty string when there is nothing to say. It takes any translate function and reads its keys from the `issues` namespace.

## Colour the frame

`flowNodeIssueFrameClass(counts)` returns the border class for the node's worst problem from `ISSUE_SEVERITY_FRAME_CLASS`: the destructive red for an error, amber for a warning, or an empty string. Both keep 3:1 against the canvas and the node's card. Add it to the node's border classes. The colour changes instantly; colour is never animated. Keep the selection on a ring (`ring-2 ring-ring`), so a selected node with a problem shows both. The frame repeats what the marker says; colour alone is never the only signal.

The counts per node come from the host, for example by grouping a validation result's issues by the node each one names.
