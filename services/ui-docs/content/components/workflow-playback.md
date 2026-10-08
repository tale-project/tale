---
title: Workflow playback
description: Show how a run went on a workflow chart, and replay it with values travelling the lines, a scrubber and the failure in focus.
---

`WorkflowCanvas` shows a run two ways. An overlay says where each node ended, with no time. A playback replays the run: your host owns the moment `t`, the canvas draws the run at that moment, and dots carry values along the lines. Both bring a failed run's way to its first failure forward.

```tsx
import { WorkflowCanvas } from '@tale/ui/flow/workflow-canvas';
import {
  buildPlaybackTimeline,
  flowStateAt,
  usePlaybackClock,
  type FlowRunOverlay,
} from '@tale/ui/flow/playback';
import { FlowPlaybackBar } from '@tale/ui/flow/playback-bar';
```

## Show where a run ended

<Demo name="flow/static-overlay" />

Pass a `FlowRunOverlay` as `overlay`: each node's `state`, and optionally a `detail` such as "1.4 s", a `reason` such as the error line, a condition's `decision`, the `items` of a node that runs once per item, and the `pass` of one that repeats. Set `finished` when the run is over, so a node it never reached reads as not run.

Leave `edges` out to let the canvas work out the lines. A line counts as travelled when its source succeeded and its target started, and as not taken when its condition decided the other way or its target was skipped.

| State | The box |
| --- | --- |
| Running | Blue frame and a top bar that sweeps across, still under reduced motion |
| Waiting | Amber frame and top bar |
| Succeeded | Plain |
| Failed | Red frame and left edge; the strip shows the error line |
| Skipped, stopped, not run | Dashed border |

Each box shows its state's glyph and says its state in its name, such as "Classify (Succeeded)". Its strip says the reason or the state, then the detail: "Succeeded · 1.4 s". A condition shows a **Yes** or **No** chip; the branch it took gets a check, the other a dash and a thin line. A frame counts "12 of 50 items" or "Pass 3 of 5". No text is ever faded.

When the run failed, the canvas brings forward the way the run took to the first failure and steps back from the rest. The line into the failed node turns red. Without an error line, the failed node's strip says "The run stopped here". Set `focusFailure={false}` to show the run without the focus. A `highlight` you pass wins over it.

## Replay a run

<Demo name="flow/playback" />

Press **Play**, drag the scrubber, or step between events. The answer waits three hours for an approval; the replay shows that wait as a hatched band and moves on.

1. Record the run in real time: each node's spans with `startedAt` and `endedAt`, each moment a value left a node (`travels`, with the `target` it goes to), and each wait.
2. Build the timeline once with `buildPlaybackTimeline(run)`.
3. Drive it with `usePlaybackClock({ timeline })` and pass `playback={{ timeline, t }}` to the canvas.
4. Put `FlowPlaybackBar` under the canvas, fed by the same clock.

`buildPlaybackTimeline` compresses real time piece by piece. The stretch between two moments plays for its real length, but at least `minStepMs` (240 ms) and at most `maxGapMs` (1.2 s), and each value gets `travelMs` (320 ms) to reach its target before the target starts. A long wait becomes a `wait` mark with your words; a failure becomes a `failure` mark. `toReal(t)` and `fromReal(ms)` map between playback and real time, so the bar can show how long the run really took.

`flowStateAt(graph, timeline, t)` is the frame the canvas draws. Use it to say what is happening for the scrubber's spoken value (`activity`), or to drive the List view.

## Watch the values travel

While a value is on its way, an 8 px dot rides its line. Its motion is a Web Animation created paused: every change of `t` sets its `currentTime`, so playing, scrubbing and stepping are the same operation. It fades in over the first 8 % of the line and dissolves into the box it reaches. Strips settle softly when their words change while the run plays forward; scrubbing back swaps them at once.

While the run plays, the canvas follows the node it reaches into view, until the reader moves the view.

Under reduced motion there are no dots: a line switches to travelled when its value arrives. **Play** steps from event to event every 600 ms instead of sweeping.

## Control the replay

`usePlaybackClock` opens on the end of the run, which shows the whole story. Playing from the end starts over. On a live timeline it follows the growing end until the reader moves `t`, and `follow()` returns to it.

`FlowPlaybackBar` holds play or pause, previous and next event, a scrubber with a tick for each event, the time and the speed. The speed is a segmented control, folded into a menu on a phone. A live run shows **Live**, and **Follow live** while the reader is behind its end. The play button's name says what it does next.

| Key | Does |
| --- | --- |
| Space | Plays or pauses, anywhere on the bar except a button |
| ← / → | Moves the scrubber by 1 % |
| Page Down / Page Up | Moves it by 10 % |
| Home / End | Jumps to the start or the end |
| `[` / `]` | Steps to the previous or next event |

The scrubber is named "Run timeline" and says where it is, such as "00:42 of 03:10 — Classify running", from `formatTime` and your `activity` words.

## Props

`FlowPlaybackBar`:

| Prop | Type | Notes |
| --- | --- | --- |
| `timeline` | `FlowPlaybackTimeline` | From `buildPlaybackTimeline`. |
| `t` / `onTChange` | `number` | The moment shown, in playback ms. |
| `playing` / `onPlayingChange` | `boolean` | |
| `speed` / `onSpeedChange` | `0.5 \| 1 \| 2 \| 4` | The speed control shows only with `onSpeedChange`. |
| `formatTime` | `(t) => string` | Defaults to playback time as `mm:ss`; pass `formatFlowClock(toReal(t) - startedAt)` for real time. |
| `activity` | `string` | What happens at `t`, for the scrubber's spoken value. |
| `onFollowLive` | `() => void` | Shows **Follow live** on a live run. |

On `WorkflowCanvas`, see [Workflow canvas](/docs/components/workflow-canvas#props) for `overlay`, `playback` and `focusFailure`.
