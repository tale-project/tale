---
title: Workflow paths
description: Show every way a run can go through a workflow, preview and pin one path at a time, and point out the nodes that end a run when they fail.
---

A workflow with conditions can run in more than one way. `FlowPath` describes one of those ways as plain data, the highlight helpers turn one or more paths into what the canvas brings forward, and `FlowPathList` is the list a reader explores them with. The reader points at a path, pins it, and the chart steps back from everything that does not run on it.

```tsx
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import { FlowPathList } from '@tale/ui/flow/flow-path-list';
import {
  highlightForPaths,
  highlightForBranch,
  highlightForNodes,
  type FlowPath,
  type FlowHighlight,
} from '@tale/ui/flow/paths';
```

## Explore the paths

<Demo name="flow/possible-paths" />

Point at a path in the list to preview it on the chart, and press Enter or click to pin it. Press Escape or **Show all** to unpin. Point at a row under **Ends the run when it fails** to ring those nodes in red, and choose one to open it. Rest the pointer on the condition, or on its **Yes** or **No** label, to see the paths through it.

## Describe the paths

Your host works the paths out from its own analysis of the workflow. Each `FlowPath` lists the steps and conditions that run on it and how each condition decided:

```ts
const path: FlowPath = {
  id: 'p2',
  label: 'Path 2',
  nodes: ['fetch', 'classify', '__gate:escalate', 'answer', 'log'],
  decisions: { 'when:escalate': false },
};
```

`decisions` is keyed by each gate's `decisionKey`, or by its id when it has none. `true` takes **Yes** and `false` takes **No**. Start and End are on every path, so leave them out.

| Helper | Brings forward |
| --- | --- |
| `highlightForPaths(graph, paths)` | Every node on any of the paths, Start and End, and every line a run on one of them follows. A **Yes** or **No** line counts only on a path where its condition decided that way. |
| `highlightForBranch(graph, paths, gateId, decision?)` | The paths that consult the condition, only those where it decided `decision` when you give it. With no paths, the condition and everything below the branch's target. |
| `highlightForNodes(graph, ids, { tone })` | A set of nodes and the lines between them. `tone: 'error'` rings them in the error red. |
| `highlightForIncident(graph, id)` | A node's own lines, without quieting anything. |

## Show a highlight on the canvas

Pass a `FlowHighlight` as `highlight`. Inside it, boxes are lifted and ringed and lines stand out at 2.5 px. Outside it, boxes step back: a dashed border on a muted surface, with their words at full contrast. Lines thin to 1 px and keep their colour and dash, so a quiet line still reads at 3:1. Colour and width never animate; two stacked lines crossfade their opacity over 150 ms. Under reduced motion the change is instant.

Give `reasons` to say why a node steps back, such as "Not on Path 2" or "Skipped: Inbox was empty". The reason replaces the node's strip and joins its accessible description. Give `announcement` to have the canvas say the highlight once in a polite live region. Set `quietRest: false` to bring things forward without quieting the rest.

Your `highlight` wins over the canvas's own. Pass `null` to leave the canvas's own highlights:

- A pointer or keyboard focus on a node brings its own lines forward and quiets nothing, so tabbing through the chart never flickers.
- With `paths`, a pointer that rests 150 ms on a condition, or on a **Yes** or **No** label, highlights the paths through it. Pass an empty list when your analysis gave up (too many conditions to list every path); the branch then highlights what lies below its target.

`onHighlightChange` reports the canvas's own highlight as it changes, so a list beside the chart can follow it.

## List the paths

`FlowPathList` renders the paths, and anything else the reader can point at, in sections:

```tsx
<FlowPathList
  sections={[
    { id: 'paths', rows: [{ id: 'p1', title: 'Path 1', meta: '4 of 5 nodes run', clauses: [{ id: 'e', label: 'Escalate: Yes', tone: 'positive' }] }] },
    { id: 'halts', title: 'Ends the run when it fails', rows: [{ id: 'fetch', title: 'Fetch', pinnable: false }] },
  ]}
  aria-label="Paths a run can take"
  previewId={preview}
  pinnedId={pinned}
  onPreview={setPreview}
  onPin={setPinned}
  onActivate={openNode}
  announce={(row) => `Showing ${row.title}`}
/>
```

Pointing at a row or focusing it calls `onPreview`. Enter, Space or a click calls `onPin` with the row's id, and again with `null` to unpin. A row with `pinnable: false` calls `onActivate` instead. A clause shows its words with a tone dot, so the tone never speaks alone.

Place the list in a panel that stays open while the reader clicks the chart, not in a popover that closes on the first click elsewhere. Show the highlight of the pinned row, else of the previewed one.

## Use the keyboard

The list is one Tab stop across all its sections. ↓ and ↑ move between rows, Home and End jump to the first and last. Enter or Space pins or opens a row. Escape unpins from a row or from **Show all**, and a screen reader hears your `announce` words once for each pin.

Unpinning ends the preview too (`onPreview(null)`), so the chart shows every path again. Focus stays on the row that was pinned, or returns to it from **Show all**, without previewing it; the next arrow key previews as usual.

While a path is pinned, the list claims Escape, so inside a sheet the first Escape unpins and the next one closes the sheet. The chart itself highlights only a node's own lines on keyboard focus; the list is how a keyboard reaches a single path.

## Props

`FlowPathList`:

| Prop | Type | Notes |
| --- | --- | --- |
| `sections` | `{ id, title?, description?, rows, footer? }[]` | Rows in order; one Tab stop across all of them. |
| `previewId` / `onPreview` | `string \| null` | The row a pointer or focus is on. |
| `pinnedId` / `onPin` | `string \| null` | The pinned row; `onPin(null)` unpins. |
| `onActivate` | `(id) => void` | A row with `pinnable: false` was chosen. |
| `announce` | `(row) => string` | Said once when a row is pinned. |
| `aria-label` | `string` | Names the list. |
| `empty` | `ReactNode` | Shown when no section has a row. |

On `WorkflowCanvas`, see [Workflow canvas](/docs/components/workflow-canvas#props) for `paths`, `highlight` and `onHighlightChange`.
