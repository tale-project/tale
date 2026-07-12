# Impact detection & affected-by — the optimal check

Read when changing [`impact.ts`](impact.ts), [`report.ts`](report.ts), or the
instrument's counterfactual. This is the answer to "how do we optimally check which
elements have visual impact, and which are affected by the matched elements."

## Impact is temporal, not a snapshot

Ground truth is "hide the element; if the rendered frame changes, it had impact." But an
element can flip from no-impact to impactful **mid-session** — an image finishes loading,
text is injected, it scrolls into view, an occluder is removed — and back again. So a
single point-in-time hide-and-diff would mislabel an element by the one instant it was
probed. The correct primitive is to **evaluate impact per frame and union it
(ever-impactful)**, derived from the continuous recording we already collect.

`effectivePaint(sample)` in [`impact.ts`](impact.ts) encodes one frame's verdict;
`hasPaintImpact` ORs it across the session and `paintIntervals` reports _when_.

## Two modes, two independent checks

| Mode               | Question                             | Signal                                                                                                   |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **paints**         | renders pixels the user sees         | `paints` (text/bg/border/shadow/replaced) AND `visible` AND `inViewport` AND `opacity>0` AND `!occluded` |
| **affects layout** | occupies space that positions others | observed co-movement + layout-shift sources + counterfactual                                             |

Occlusion is folded into the paint check, so a paints-in-isolation element fully covered
by an opaque element scores zero — the same verdict the pixel counterfactual gives, for
free.

## The two-tier strategy (cheap first, counterfactual last)

**Tier 1 — observe from the continuous record (no DOM mutation).** The page runs the
experiment for us: whenever a tracked element changes size/position/presence, any
candidate that moves _in the same frame_ is affected by it (`computeAffected` →
co-movement). `layout-shift` entries whose `sources[]` co-occur (within a frame budget)
with a tracked change confirm it. This is inherently temporal and catches elements that
only become affected partway through.

**Tier 2 — the counterfactual, targeted.** Used only where Tier 1 is ambiguous, at the
_moments_ that matter:

- **Layout, invisible.** For a tracked element that never changed on its own (no free
  experiment), the instrument's `keyframe()` sets `display:none`, reads every candidate
  rect (forces synchronous layout), and restores — **all before the browser paints**, so
  the user sees nothing. Elements that move become its `layoutProbe.movedKeys`.
- **Paint, brief flash.** Only for genuine occlusion ambiguity: the driver toggles
  `visibility:hidden`, recaptures, diffs the element's **sub-rect** (occlusion-correct),
  and restores — at keyframes, not once.

## Affected-by attribution is causal

`affectedBy` lists the tracked elements that _moved in the same frame_ as the candidate
(`recordAttribution`). Co-movement proposes; layout-shift sources and the counterfactual
confirm. Because a tracked element that itself moves is reported as `matched` (not
`affected`), candidates are the only `affected` entries — keeping attribution clean.

Same-frame co-movement is correlational, so it is constrained by **how layout can actually
propagate a displacement**, keyed on whether the candidate is in normal flow that frame
(`outOfFlow`, sampled from computed `position`):

- **In flow** (`static`/`relative`/`sticky`): a preceding element's growth shifts it, so any
  co-changing tracked element is a plausible cause. `relative` and `sticky` stay in flow, so
  they remain pushable (a `relative` element offset via `top` is _also_ pushed by content
  above it — both are real).
- **Out of flow** (`absolute`/`fixed`): a sibling's in-flow growth **cannot** move it — only
  its containing block can. So it is attributed solely to a co-changing **ancestor** (the
  positioned ancestor it is laid out against); a coincidental same-frame self-move (e.g. an
  absolute element animating its own `top`) next to an unrelated grower is **not** attributed.

**Boundaries** (where attribution is intentionally conservative, not a bug):

- Causation is computed for **candidates**; a tracked component root that is itself dragged by
  another element is reported as `matched` with its move captured, but without an `affectedBy`
  arrow.
- An element first made "relevant" by the very change you are measuring is discovered at that
  moment, so its **before**-state isn't sampled (no move recorded) — the general temporal /
  discovery boundary, not specific to positioning.
- Two **in-flow** elements that move in the exact same keyframe are both candidates for
  attribution from co-movement alone; document order isn't modelled, so a genuine push and a
  same-frame coincidence are only separated when a layout-shift source or counterfactual
  weighs in.

## Cost controls

- The paint-property timeline is event-driven (recompute on mutation, not every frame).
- The rAF sampler follows only tracked + candidate elements (candidates are each tracked
  element's ancestor chain plus the nodes a `layout-shift` names as sources), never the whole
  DOM.
- Pixel diffs are sub-rect, skipped when a cheap frame hash is unchanged.
- The counterfactual is the exception — batched, time-targeted, never a per-frame sweep.

## Anchor resolution (steps 6-7)

[`anchors.ts`](anchors.ts) applies the ordered rules and stops at the first match:
screen (constant in viewport coords, no page anchors) → page (all four document edges
constant) → ancestor (highest ancestor preserving the direct parent's constant-offset
edge set) → `null`. Computed on the element's primary segment so multi-segment sessions
stay deterministic.

**Single-axis scroll is handled per edge.** Screen anchoring is decided edge-by-edge:
an edge is screen-anchored when, in at least one frame, the page scrolled _under_ it
(the edge held constant in viewport coords while it moved in document coords). So a
full-width fixed bar under vertical-only scroll has its top/bottom edges pinned to the
screen and resolves to `screen` (with `anchoredEdges: ['top','bottom']`) — it does not
need both axes to scroll. An element the page never scrolls under has no screen-anchored
edges and falls through to the page/ancestor/null rules.
