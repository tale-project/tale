/**
 * Compute step execution order from the nextSteps graph.
 *
 * Uses a modified Kahn's algorithm (topological sort) that:
 * - Skips "noop" targets (terminal markers, not real steps)
 * - Rewires loop back-edges so body steps are ordered before "done" targets
 * - Handles fan-in (diamond/merge) patterns correctly
 * - Assigns unreachable steps order = max + 1
 */

interface StepForOrdering {
  stepSlug: string;
  stepType: string;
  nextSteps: Record<string, string>;
}

/**
 * Compute 1-based execution order for each step from the nextSteps graph.
 *
 * The start/trigger step always gets order 1. Subsequent steps get
 * incrementing orders based on topological sort of the DAG formed
 * by nextSteps (with loop cycles broken and rewired).
 */
export function computeStepOrder(
  steps: StepForOrdering[],
): Map<string, number> {
  if (steps.length === 0) return new Map();

  const slugSet = new Set(steps.map((s) => s.stepSlug));
  const stepTypeMap = new Map(steps.map((s) => [s.stepSlug, s.stepType]));

  // Phase 1: Identify loop structures and rewire edges.
  //
  // For each loop step with {loop: bodySlug, done: doneSlug}:
  //   - Keep edge: loop → bodySlug (forward into body)
  //   - Remove edge: loop → doneSlug (would bypass body)
  //   - Find tail steps (steps whose nextSteps point back to loop)
  //   - Add edge: tailStep → doneSlug (ensures body completes before done)
  //   - Remove back-edges: tailStep → loop (break cycle)

  // Collect loop info: which steps point back to which loop steps
  const backEdgeSources = new Map<string, string[]>(); // loopSlug → [tailStepSlugs]
  for (const s of steps) {
    for (const [port, target] of Object.entries(s.nextSteps)) {
      if (!target || target === 'noop' || !slugSet.has(target)) continue;
      if (
        stepTypeMap.get(target) === 'loop' &&
        port !== 'done' &&
        s.stepType !== 'start' &&
        s.stepType !== 'trigger'
      ) {
        const sources = backEdgeSources.get(target) ?? [];
        sources.push(s.stepSlug);
        backEdgeSources.set(target, sources);
      }
    }
  }

  // Phase 2: Build adjacency list with rewired edges
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const s of steps) {
    adjacency.set(s.stepSlug, []);
    inDegree.set(s.stepSlug, 0);
  }

  function addEdge(from: string, to: string) {
    const edges = adjacency.get(from);
    if (edges) edges.push(to);
    inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
  }

  for (const s of steps) {
    const isLoop = s.stepType === 'loop';
    const tailSteps = isLoop ? backEdgeSources.get(s.stepSlug) : undefined;

    for (const [port, target] of Object.entries(s.nextSteps)) {
      if (!target || target === 'noop' || !slugSet.has(target)) continue;

      // Skip back-edges to loop steps (body → loop)
      const targetIsLoop = stepTypeMap.get(target) === 'loop';
      if (
        targetIsLoop &&
        port !== 'done' &&
        s.stepType !== 'start' &&
        s.stepType !== 'trigger'
      ) {
        continue;
      }

      // For loop steps: skip the direct "done" edge if we have tail steps to rewire through
      if (isLoop && port === 'done' && tailSteps && tailSteps.length > 0) {
        // Rewire: tail steps → done target instead of loop → done target
        for (const tail of tailSteps) {
          addEdge(tail, target);
        }
        continue;
      }

      addEdge(s.stepSlug, target);
    }
  }

  // Phase 3: Kahn's algorithm — only seed with start/trigger step
  const queue: string[] = [];
  const startStep = steps.find(
    (s) => s.stepType === 'start' || s.stepType === 'trigger',
  );

  if (startStep && inDegree.get(startStep.stepSlug) === 0) {
    queue.push(startStep.stepSlug);
  }

  // Fallback: if no start/trigger, seed with nodes that have in-degree 0
  // but defer orphaned nodes (they'll be caught at the end)
  if (queue.length === 0) {
    for (const [slug, deg] of inDegree) {
      if (deg === 0) {
        queue.push(slug);
      }
    }
  }

  const orderMap = new Map<string, number>();
  let nextOrder = 1;

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined || orderMap.has(current)) continue;
    orderMap.set(current, nextOrder++);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0 && !orderMap.has(neighbor)) {
        queue.push(neighbor);
      }
    }
  }

  // Phase 4: Assign unreachable/orphaned steps max + 1
  const maxOrder = nextOrder - 1;
  for (const s of steps) {
    if (!orderMap.has(s.stepSlug)) {
      orderMap.set(s.stepSlug, maxOrder + 1);
    }
  }

  return orderMap;
}
