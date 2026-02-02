/**
 * Circular Dependency Validator
 *
 * Detects circular dependencies in workflow step connections.
 * Uses depth-first search (DFS) with visited/visiting state tracking.
 */

import type { ValidationResult } from './types';

interface StepWithNextSteps {
  stepSlug: string;
  nextSteps?: Record<string, string>;
}

interface CircularDependencyResult extends ValidationResult {
  cycles: string[][];
}

/**
 * Detect circular dependencies in workflow steps.
 *
 * @param steps - Array of steps with stepSlug and nextSteps
 * @returns Validation result with detected cycles
 */
export function validateCircularDependencies(
  steps: StepWithNextSteps[],
): CircularDependencyResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cycles: string[][] = [];

  const graph = new Map<string, string[]>();
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

  if (cycles.length > 0) {
    for (const cycle of cycles) {
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
