---
title: Workflow canvas
description: Draw a workflow from its data with an automatic layout, lines that route round every box, a keyboard path through it and a List view that says the same in text.
---

`WorkflowCanvas` draws a workflow from plain data: Start, the steps in the order they run, the conditions in front of them, End, and the frames round steps that run once per item or repeat. Nobody places a box. The layout is a pure function of the graph, so the same graph always draws the same picture, and lines follow routes that never cross a box.

```tsx
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import type { FlowGraph } from '@tale/ui/flow/types';
import { FlowStepList } from '@tale/ui/flow/flow-step-list';
import { FlowLegend } from '@tale/ui/flow/flow-legend';
import { FlowNodeStatusBadge } from '@tale/ui/flow/node-status';
import { layoutFlowGraph, flowNodeSize } from '@tale/ui/flow/layout';
import { diffHighlight, mergeFlowGraphs } from '@tale/ui/flow/diff';
```

## Draw a workflow

<Demo name="flow/layout" />

Build a `FlowGraph` and pass it with an `aria-label` and a `layoutKey`. Choose a box to see `onSelect` report it; choosing it again clears the selection.

A graph has three parts:

| Part | What it holds |
| --- | --- |
| `nodes` | In reading order: one `entry` (Start), the `step` nodes, a `gate` for each condition, placed right before the step it guards, and one `exit` (End). The order is the layout's model order and the List view's order. |
| `edges` | `source`, `target` and a `kind`. An edge marked `layoutOnly` shapes the picture but is never drawn. |
| `groups` | A frame round the steps that run once per item (`each`) or repeat (`repeat`), with the words of its header. |

Every node is drawn from its data. A step shows its `icon`, `label` and `typeLabel`, what it `returns` (a shape in mono, or a sentence), up to two `chips` and `markers` in its title row. Its strip says what it `reads`. Pass `returns: null` to reserve the row while your host is still working the shape out: a pulse fills it, and the box does not grow when the shape arrives. A step that may be skipped (`conditional`) is drawn with a dashed border; one that never runs (`unreachable`) also carries a **Never runs** chip. Its text is never faded.

`layoutKey` names what the picture shows, such as a document and the version on screen. When the same key gets a changed graph, the canvas lays it out again and keeps each row in its order, so no box swaps sides with its neighbour. A new key is another picture: it is laid out afresh and fades in.

## Watch it change

<Demo name="flow/live-relayout" />

Save the next version to see the chart glide to its new layout. A graph that changes under the same `layoutKey`, such as a version a coding agent saved or a field edit that adds a reference, moves in three beats:

| What | Moves | Timing |
| --- | --- | --- |
| A node, condition or frame that leaves | Shrinks out at its old place | 150 ms |
| A line that leaves or takes another route | Fades out along its old route | 150 ms |
| A node, condition or frame that stays | Glides to its new place | 300 ms, from the start |
| A node or condition that joins | Grows in | 200 ms, after 150 ms |
| A frame that changed size | Fades out, then in at its new size | 150 ms, then 200 ms after 250 ms |
| A line that joins or takes another route | Fades in | 200 ms, after 250 ms |

The chart has settled 450 ms after the new layout lands, and no line is drawn against a box that is still moving. The motion uses the duration tokens and the out-quint ease, and only transform and opacity. If the view was still where the fit left it, it eases to the new fit; otherwise the open node is brought back into view if it moved out. A change that arrives while a glide is under way starts from where everything is.

Pass `changed` with the ids of the nodes that changed outside this tab, such as a version saved in another window, and a new `key`. Those nodes show a ring that fades out once the glide is done. Leave out your reader's own edits: a field they just changed never rings. The key the canvas opens with is never rung.

Under reduced motion none of this plays: the new layout is simply there, and nothing rings.

## Follow the lines

<Demo name="flow/routed-edges" />

Each line follows the route the layout computed: orthogonal, with 8 px rounded corners and an arrowhead tinted like the line. Split leads to Report past Score's frame, and its route goes round the frame instead of through it. Turn on the switch to see the route's points, which `onLayout` hands you with the rest of the layout.

| `kind` | Drawn as | Means |
| --- | --- | --- |
| `data` | Solid | The target reads the source's output. |
| `order` | Dashed | The target only mentions the source in a condition or a repeat. |
| `gate` | Solid, from a condition | The step runs only if the condition holds. |
| `branch-yes` / `branch-no` | Green / amber, with a Yes / No pill | Which step runs when the condition holds or does not. |
| `entry` | Solid, from Start | The node reads no other node. |
| `exit` | Solid, into End | The run returns this node's output. |
| `completion` | Dotted, into End | Nothing reads this node: the run ends after it. |

Colour never speaks alone: an `order` line is dashed, a `completion` line dotted, and the branches carry their words. Every line keeps 3:1 against the canvas in both themes. The No branch uses its own variable, `--flow-edge-negative`, because the warning amber is too faint for a line on white. Give an edge a `detail` ("Carries .items") to show it when a pointer rests on the line; put the same words in a node's description for the keyboard.

## Frame steps that repeat

<Demo name="flow/containers" />

A frame is drawn round each step that runs once per item or repeats, with its header in your words. Give each iterating step a frame of its own, even when three steps go through the same list: each finishes every item before the next one starts, so one shared frame would claim the opposite. A `repeat` frame draws its loop as a dashed arc on its right.

A frame is decoration, hidden from assistive technology. Repeat its words in the member's `description`, as `Runs once for each item of …`, so a screen reader hears them too. The header is a box the layout routes round, so no incoming line runs through its words.

## Show Start and End

<Demo name="flow/entry-exit" />

Start lists what starts a run (`triggers`, three rows) and what each run receives (`inputs`, four rows). A section with more rows shows the first ones and "+2 more"; the List view and the node's description keep every row. A row takes a muted `detail`, a second-line `note`, a `badge` such as "Off", and `code` for a field name. `inputsEmpty` replaces "No input" with your own words, such as "Any JSON input". A `notice` — one line of warning or information — takes the place of the strip's words at the box's foot, so it never changes the box's size.

End lists what a successful run returns (`outputs`), an optional one-line `shape`, and how a run can end (`outcomes`). A `shape` is a string or `{ text, code }` (mono when `code`); `null` holds its row with a placeholder while your app still works it out, so End never grows when the answer comes. Start's strip names the nodes it leads to; End's names the nodes it comes from; either says its `notice` instead when it has one.

## Mark problems

<Demo name="flow/issues" />

Pass `issues`, a map from node id to error and warning counts. Each box shows the counts with [flow node issue markers](/docs/components/flow-node-issues), takes the frame colour of its worst problem, and says the counts at the end of its name. Start, End and conditions take counts like any step: key them by their ids, such as `__start`, `__end` and `__gate:triage`.

## Read it as a list

<Demo name="flow/list-view" />

The List view says the same as the chart in text. `FlowStepList` renders an ordered list: Start, each node in reading order, End. Under each row it says what the node reads, when it runs, with the condition folded in as "Runs only if …" or "Runs when the condition of … is false", and where it leads. The members of a frame sit indented under the frame's words.

Inside `WorkflowCanvas`, **Show as list** in the corner switches to this view and **Show as chart** switches back. The choice is stored in the browser under `tale:flow-view`. On a screen narrower than 24rem the list is the default. Pass `view` and `onViewChange` to control it yourself; the built-in button then goes away.

## Show a run or a path

Pass a run as `overlay` (where each node ended) or `playback` (a moment of a replay) to frame each node by its state and draw the lines the run took. A failed run brings the way to its first failure forward. See [Workflow playback](/docs/components/workflow-playback).

Pass `paths` and `highlight` to bring one path, one branch or a set of nodes forward and step back from the rest. See [Workflow paths](/docs/components/workflow-paths).

## Compare two graphs

<Demo name="flow/diff" />

`mergeFlowGraphs(before, after, changed)` draws two versions of a workflow as one graph: every node of the newer version, and each node only the older one had, right after the node it followed there. Pass the graph it answers to the canvas, and the overlay it answers as `diff`. In this excerpt, `v4` and `v5` are the two versions' graphs and `changes` holds your words for what changed in each node:

```tsx
const { graph, diff } = mergeFlowGraphs(v4, v5, (id) => changes[id]);

<WorkflowCanvas
  graph={graph}
  diff={diff}
  aria-label="Changes from v4 to v5"
  layoutKey="tickets:v4..v5"
/>;
```

The canvas only knows the two graphs' shapes; whether a node's prompt or model changed is for your app to work out. `changed(id)` answers, for a node, `{ kind, summary }`: `kind` is `changed`, `renamed`, `added` or `removed`, and `summary` your words, such as "Model changed". Leave a node out when nothing changed. A node only one version has is added or removed without your answer, and a node whose kind changed under the same id, such as a step that became a condition, reads as changed. For a rename, answer `{ kind: 'renamed', renamedFrom: 'Answer', beforeId: 'answer' }`: the old name in words and the node's id in the older version. The canvas then draws one box, and the lines the old id had count as its own.

Each box says what became of it, and keeps its size, so the layout does not change for the marks:

- An added box has a green frame and an **Added** badge.
- A removed box has a red frame, a hatched surface, its title struck through, and a **Removed** badge.
- A changed box has an amber frame and a **Changed** badge; its foot says your `summary`.
- A renamed box has an amber frame and a **Renamed** badge; its foot says its old name, such as "Was Answer".

A condition shows its badge in its pill, and your words in its tooltip. A frame only one version has takes its colour and its badge.

Two lines are the same line when they join the same two nodes and are of the same kind; a line that changed its kind reads as one removed and one added. A line only the newer version draws is green with a plus at its middle, and one only the older version drew is red with a minus; a Yes or No line carries the sign in its own pill, such as "− Yes". Every other line is drawn in the plain line colour, Yes and No included, so no green or amber reads as a change. A pointer resting on a changed line reads "New connection" or "Removed connection". An older line that would close a loop, such as between two nodes that swapped places, is left out, and so is an older frame the merged graph cannot draw; the nodes still say what changed.

The canvas adds lines to the legend for its marks. Each box is named with its change, such as "Classify (Changed)", and described with your words. The List view shows each row's badge, keeps a removed row where it stood, and says a condition's change on the step it guards. `diff` takes the place of a run: if you also pass `overlay`, `playback` or `compare`, the canvas shows the two versions and warns in development.

To show one version's own graph with what changed brought forward, pass `diffHighlight(graph, diff)` as `highlight`: the boxes that changed are ringed and their lines stand out, and nothing else steps back. The demo's **v4** and **v5** do this.

## Use the keyboard

The chart is one Tab stop: the selected node, else the node focused last, else Start. From there:

| Key | Moves to |
| --- | --- |
| ↓ / ↑ | The next or previous node along a line, the one most in line with the current node |
| ← / → | The neighbour in the same row |
| Home / End | Start / End |
| Enter / Space | Opens the node (`onSelect`); again on the selected node clears it |

A box that takes keyboard focus outside the view is brought into it with the least pan. Each box is a real button, named by its title (a condition by "Condition for Triage: …") and its problems, and described by its position, the nodes it comes from and leads to, its conditions, what it reads, and your `description`. React Flow's own focus handling and keys stay off.

When the button opens a panel, pass that panel's id as `controlsId`: each node then says whether the panel is open (`aria-expanded`) instead of whether it is pressed. Handle Escape in your page, where the panel lives.

## Fit, zoom and touch

`fitPolicy="auto"`, the default, fits the whole graph while the zoom stays at 0.5 or more. A taller graph is shown from its top at a readable zoom, centred on Start, and the reader scrolls on. `all` always fits every node. The fit follows the frame's size and a new layout while the view is still where the fit left it; once the reader zooms or pans, the view is theirs until **Reset view**.

Viewport moves ease out over the duration tokens: zoom 150 ms, reveal 200 ms, reset 300 ms. Under reduced motion they jump. `framed` draws a bordered frame for a page; on a touch screen one finger then scrolls the page and two move the chart, and the first one-finger drag says so once. Set `touchPolicy` to choose either behaviour yourself.

`topStart`, `topEnd`, `toolbar` and `cornerActions` place your own controls. The List view keeps `topStart` and `topEnd` above the list and `toolbar` at its foot, so a phone that opens on the list still reaches them. `legend` adds a **Legend** button that explains the marks your chart uses in your words. `notice` sits above the chart and `empty` replaces it when the graph has no nodes.

## Lay out without the canvas

`layoutFlowGraph(graph, options)` answers the layout itself: absolute boxes, frame headers, routes, label boxes and rows. It runs ELK (`layered`, orthogonal) in a worker started from the file elkjs ships, so a layout never blocks typing and needs no `blob:` worker or `eval`. Where the worker cannot start, it lays out on the main thread and warns once. Where ELK fails or takes five seconds, it stands every node in one column and the canvas says it could not arrange the nodes; the chart never stays empty. Layouts of graphs already seen this session come from a cache.

`flowNodeSize(node)` gives the size every box is drawn at, a pure function of its data. A step is 288 px wide and 88, 108, 116 or 136 px high, by whether it has a returns row and chips. Nothing a canvas shows on top, such as a run's state, a problem or a selection, changes a size, so none of it moves a box. A 40-node graph lays out in about a tenth of a second in the worker.

## Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `graph` | `FlowGraph` | — | The workflow, in reading order. |
| `aria-label` | `string` | — | The chart's name. |
| `layoutKey` | `string` | — | What the picture shows; a new key lays out afresh. |
| `selectedId` / `onSelect` | `string \| null` / `(id) => void` | — | The open node. |
| `revealId` | `string \| null` | — | Brings this node into view. |
| `issues` | `ReadonlyMap<string, IssueCounts>` | — | Problem counts by node id. |
| `controlsId` | `string` | — | The panel a node opens. |
| `overlay` | `FlowRunOverlay` | — | A run without time: where each node ended. |
| `playback` | `{ timeline, t }` | — | A run at moment `t`; wins over `overlay`. |
| `diff` | `FlowDiffOverlay` | — | Two versions on one chart, from `mergeFlowGraphs`; wins over `overlay`, `playback` and `compare`. |
| `focusFailure` | `boolean` | `true` | Brings a failed run's way to its failure forward. |
| `paths` | `FlowPath[]` | — | Lets a pointer on a condition or a Yes/No label highlight its paths. |
| `highlight` / `onHighlightChange` | `FlowHighlight \| null` | — | Your highlight wins over the canvas's own; the callback reports the canvas's own. |
| `changed` | `{ ids, key }` | — | Nodes changed outside this tab, ringed once when `key` changes. |
| `view` / `onViewChange` | `'chart' \| 'list'` | stored choice | Controls the view. |
| `framed` | `boolean` | `false` | A bordered frame for a page. |
| `touchPolicy` | `'pan' \| 'page-scroll'` | `framed ? 'page-scroll' : 'pan'` | What one finger does on a touch screen. |
| `fitPolicy` | `'all' \| 'auto'` | `'auto'` | How the view fits the graph. |
| `topStart`, `topEnd`, `toolbar`, `cornerActions` | `ReactNode` | — | Your controls. |
| `legend` | `FlowLegendEntry[]` | — | The legend's lines. |
| `empty`, `notice` | `ReactNode` | — | Instead of, and above, the chart. |
| `onLayout` | `(layout: FlowLayout) => void` | — | Every finished layout. |
