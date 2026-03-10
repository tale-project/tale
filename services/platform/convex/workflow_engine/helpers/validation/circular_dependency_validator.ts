/**
 * Circular Dependency Validator
 *
 * Detects circular dependencies in workflow step connections.
 * Uses depth-first search (DFS) with visited/visiting state tracking.
 *
 * Intentional cycles are allowed when the cycle contains at least one
 * `loop` or `condition` node — loop nodes have built-in termination
 * (maxIterations / items exhaustion) and condition nodes provide exit
 * branches that can break the cycle.
 */

import type { ValidationResult } from './types';

export interface StepWithNextSteps {
  stepSlug: string;
  stepType?: string;
  nextSteps?: Record<string, string>;
}

interface CircularDependencyResult extends ValidationResult {
  cycles: string[][];
}

const BREAKABLE_STEP_TYPES = new Set(['loop', 'condition']);

/**
 * Detect circular dependencies in workflow steps.
 *
 * Cycles that contain at least one `loop` or `condition` step are
 * considered intentional (pagination loops, for-each iteration) and
 * are reported as warnings instead of errors.
 *
 * @param steps - Array of steps with stepSlug, optional stepType, and nextSteps
 * @returns Validation result with detected cycles
 */
export function validateCircularDependencies(
  steps: StepWithNextSteps[],
): CircularDependencyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cycles: string[][] = [];

  const graph = new Map<string, string[]>();
  const stepTypeMap = new Map<string, string | undefined>();

  for (const step of steps) {
    const targets: string[] = [];
    if (step.nextSteps) {
      for (const target of Object.values(step.nextSteps)) {
        if (target && target !== 'noop') {
          targets.push(target);
        }
      }
    }
    graph.set(step.stepSlug, targets);
    stepTypeMap.set(step.stepSlug, step.stepType);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    if (visiting.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node];
      cycles.push(cycle);
      return true;
    }

    if (visited.has(node)) {
      return false;
    }

    visiting.add(node);
    path.push(node);

    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (graph.has(neighbor)) {
        dfs(neighbor);
      }
    }

    path.pop();
    visiting.delete(node);
    visited.add(node);

    return false;
  }

  for (const step of steps) {
    if (!visited.has(step.stepSlug)) {
      dfs(step.stepSlug);
    }
  }

  for (const cycle of cycles) {
    // Exclude the repeated tail node when checking members
    const members = cycle.slice(0, -1);
    const hasBreakableStep = members.some((slug) => {
      const stepType = stepTypeMap.get(slug);
      return stepType !== undefined && BREAKABLE_STEP_TYPES.has(stepType);
    });

    if (hasBreakableStep) {
      warnings.push(`Intentional loop detected: ${cycle.join(' → ')}`);
    } else {
      errors.push(`Circular dependency detected: ${cycle.join(' → ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    cycles,
  };
}
