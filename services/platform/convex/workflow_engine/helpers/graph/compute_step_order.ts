/**
 * Compute step execution order from the nextSteps graph.
 *
 * Uses a modified Kahn's algorithm (topological sort) that:
 * - Skips "noop" targets (terminal markers, not real steps)
 * - Identifies loop body steps via BFS from the loop's body entry
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
  const nextStepsMap = new Map(steps.map((s) => [s.stepSlug, s.nextSteps]));

  // Phase 1: Identify loop body steps via BFS, then determine true back-edges.
  //
  // For each loop step, BFS from its "loop" port target to discover all body
  // steps (stopping at the loop step itself to break cycles). Only edges from
  // body steps back to their loop step are true back-edges.
  //
  // For each loop step with {loop: bodySlug, done: doneSlug}:
  //   - Keep edge: loop → bodySlug (forward into body)
  //   - Remove edge: loop → doneSlug (would bypass body)
  //   - Find tail steps (body steps whose nextSteps point back to loop)
  //   - Add edge: tailStep → doneSlug (ensures body completes before done)
  //   - Remove back-edges: tailStep → loop (break cycle)

  const loopBodyMap = new Map<string, Set<string>>();

  for (const s of steps) {
    if (s.stepType !== 'loop') continue;
    const bodyEntry = s.nextSteps.loop;
    if (!bodyEntry || !slugSet.has(bodyEntry)) continue;

    const body = new Set<string>();
    const bfsQueue = [bodyEntry];
    let bfsFront = 0;
    while (bfsFront < bfsQueue.length) {
      const current = bfsQueue[bfsFront++];
      if (body.has(current) || current === s.stepSlug) continue;
      if (!slugSet.has(current)) continue;
      body.add(current);
      const ns = nextStepsMap.get(current);
      if (ns) {
        for (const target of Object.values(ns)) {
          if (
            target &&
            target !== 'noop' &&
            slugSet.has(target) &&
            !body.has(target)
          ) {
            bfsQueue.push(target);
          }
        }
      }
    }
    loopBodyMap.set(s.stepSlug, body);
  }

  // Back-edge sources: body steps that point back to their loop
  const backEdgeSources = new Map<string, string[]>();
  for (const s of steps) {
    for (const target of Object.values(s.nextSteps)) {
      if (!target || target === 'noop' || !slugSet.has(target)) continue;
      if (stepTypeMap.get(target) !== 'loop') continue;
      const body = loopBodyMap.get(target);
      if (body?.has(s.stepSlug)) {
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

      // Skip back-edges: only body steps pointing back to their loop
      if (stepTypeMap.get(target) === 'loop') {
        const body = loopBodyMap.get(target);
        if (body?.has(s.stepSlug)) continue;
      }

      // For loop steps: skip the direct "done" edge if we have tail steps to rewire through
      if (isLoop && port === 'done' && tailSteps && tailSteps.length > 0) {
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
  if (queue.length === 0) {
    for (const [slug, deg] of inDegree) {
      if (deg === 0) {
        queue.push(slug);
      }
    }
  }

  const orderMap = new Map<string, number>();
  let nextOrder = 1;
  let front = 0;

  while (front < queue.length) {
    const current = queue[front++];
    if (orderMap.has(current)) continue;
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
