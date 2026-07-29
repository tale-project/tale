# Transition defects — detection & report shape

Read when changing the detectors in [`src/defects/`](.) — `transitions`
(intervals + kind), `jank`, `flicker`, `dithering`, and `analyze` (the orchestrator) — or
the report schema in [`types.ts`](../types.ts). This is the answer to "how do we optimally
check flaws in transitions, and how do we show them in the JSON report."

## Find the transition first, then judge it

A defect outside a transition is noise; a transition is where smoothness is meaningful.
`transitionIntervals` finds maximal runs of frames where geometry or opacity is changing,
then each run is scored. Two disambiguations keep the **motion** detector honest:

- **Motion is a whole-box translation in both screen and page coordinates.** Pure scroll
  translates the box in only one space, so smooth scrolling never reads as motion or jank.
- **A size change alone is never motion.** Motion is measured from the shift two opposite
  edges share in the same direction, not from the top-left corner — so a width/height
  change (top-left-, bottom-right-, or centre-anchored) has zero translation and reads as
  a `resize`, never motion (and so never jank).

Each interval is typed `move | resize | fade | composite`.

## Each defect from the source that can actually see it

| Defect           | Source                             | Rule                                                                                                                                                                    |
| ---------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **layout-shift** | PerformanceObserver `layout-shift` | Read the entry; never recompute CLS. Keep sources touching a survivor; skip `hadRecentInput` (user-initiated). `severity` = entry `value`.                              |
| **flicker**      | per-frame opacity/visibility       | A clean fade is monotonic; flicker reverses. Flag ≥2 visibility toggles within 100ms (`detectFlicker`).                                                                 |
| **jank**         | per-frame geometry + frame timing  | Inside a motion interval: dropped frame (`dt > 1.5×budget`) or teleport (`jump > max(8px, 3×median)`). `severity` from jank ratio + max jump (`scoreJank`).             |
| **dithering**    | sub-rect pixel noise               | In a geometrically _static_ region: high-frequency `pixelNoise` over consecutive frames (`detectDithering`). Driver supplies `pixelNoise`; null when no diff was taken. |

## The report shows the transition timeline, not just the flaws

The schema extends the base spec so a reviewer sees intended motion _and_ its defects:

- **`transitions[]`** — one entry per interval: `kind`, `window`, `smoothness`
  (`smooth | janky | flicker | shift`), a `quality` score, `metrics`, and the `defects`
  ids that occurred within it. Defects and transitions cross-reference.
- **`defects[]`** — each carries `id`, `testid`/`selector`/`segment` linkage, normalized
  `severity` (0-1), a `window`, a **`metrics`** object exposing the raw numbers behind the
  severity (auditable and deterministic), and a human `detail`.
- **`elements[].impactMode`** — `["paints"]`, `["layout"]`, or both.
- **`elements[].label`** — the auto-detected element's `role "name"` (e.g. `nav "Main"`),
  else its CSS `selector`. Elements are auto-detected, so this is how a reader recognizes
  one; the precise `selector` is kept alongside.

The lean **compact** output (the CLI default, [`compact.ts`](../compact.ts)) distils this:
it coalesces defects, keeps a curated `metrics` per defect (the 1-2 numbers that matter for
the type) and `quality` per transition, hoists the per-type fix into a single top-level
`hints` map, and joins each element's `label` onto the defects/transitions that name it.
`--full` keeps the faithful schema above.

See [`examples/sample-report.json`](../../examples/sample-report.json) for a worked (compact)
output and [`examples/sample-recording.json`](../../examples/sample-recording.json) for its input.

## Determinism

No `Date.now()` / randomness in scoring; numbers are rounded at fixed precision and
`pixelThreshold` / `frameBudgetMs` are explicit inputs, so re-running the analysis on the
same recording yields byte-identical JSON. The `analyzer.test.ts` suite locks each
detector to a synthetic timeline.
