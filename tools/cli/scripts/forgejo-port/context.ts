/**
 * What the pipeline knows about a workflow while it is ported, and the shape of a
 * rule. Kept apart from the pipeline so the rules and the pipeline can both
 * import it.
 */

import type { Document } from 'yaml';

import type { Facts, Scalar } from './expression';
import type { Report } from './workflow';

/** What is known about a workflow while it is ported; rules add to it. */
export interface Knowledge {
  /** Context paths with a known value: `needs.pr-scope.result` is `'success'`. */
  readonly values: Map<string, Scalar>;
  /** Context paths (and below) that do not exist on Forgejo. */
  readonly absent: string[];
  /** The strings a context path can be: the events the generated workflow has. */
  readonly oneOf: Map<string, string[]>;
  /** What holds inside one job only, by job id: the size of its matrix, the steps it lost. */
  readonly jobs: Map<string, { values: Map<string, Scalar>; absent: string[] }>;
}

export function newKnowledge(): Knowledge {
  return {
    values: new Map(),
    absent: [],
    oneOf: new Map(),
    jobs: new Map(),
  };
}

export function factsOf(knowledge: Knowledge): Facts {
  return {
    values: knowledge.values,
    absent: knowledge.absent,
    oneOf: knowledge.oneOf,
  };
}

/** The facts that hold inside each job only, as the folder wants them. */
export function jobFactsOf(knowledge: Knowledge): Map<string, Facts> {
  return new Map(
    [...knowledge.jobs].map(([id, facts]) => [
      id,
      { values: facts.values, absent: facts.absent } satisfies Facts,
    ]),
  );
}

/** The mutable facts of one job, made when first asked for. */
export function jobKnowledge(
  knowledge: Knowledge,
  id: string,
): { values: Map<string, Scalar>; absent: string[] } {
  const existing = knowledge.jobs.get(id);
  if (existing) return existing;
  const made = { values: new Map<string, Scalar>(), absent: [] as string[] };
  knowledge.jobs.set(id, made);
  return made;
}

export interface PortContext {
  /** The file name under `.github/workflows`: `checks.yml`. */
  readonly file: string;
  readonly report: Report;
  readonly knowledge: Knowledge;
  /** The jobs removed so far, with why. */
  readonly removed: Map<string, string>;
}

/** A rule changes the document, and may teach the pipeline something. */
export type Rule = (doc: Document, context: PortContext) => void;

/** What a job that left the workflow is for the jobs that needed it: skipped, with no outputs. */
export function learnRemoval(knowledge: Knowledge, id: string): void {
  knowledge.values.set(`needs.${id}.result`, 'skipped');
  knowledge.absent.push(`needs.${id}.outputs`);
}
