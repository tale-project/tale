/**
 * What the pipeline knows about a workflow while it is ported, and the shape of a
 * rule. Kept apart from the pipeline so the rules and the pipeline can both
 * import it.
 */

import type { Document } from 'yaml';

import type { Conditional, Facts, Scalar } from './expression';
import type { JobResult, RemovedJob } from './ready';
import type { Report } from './workflow';

/** What is known about a workflow while it is ported; rules add to it. */
export interface Knowledge {
  /** Context paths with a known value: `needs.pr-scope.result` is `'success'`. */
  readonly values: Map<string, Scalar>;
  /** Context paths (and below) that do not exist on Forgejo. */
  readonly absent: string[];
  /** The strings a context path can be: the events the generated workflow has. */
  readonly oneOf: Map<string, string[]>;
  /** Context paths whose value depends on the event: a scope output is 'false' for a pull request. */
  readonly conditional: Map<string, Conditional>;
  /** Strings that mean another when a path is compared with them: a batch is a push. */
  readonly aliases: Map<string, Map<string, string>>;
  /** What holds inside one job only, by job id: the size of its matrix, what its own steps report. */
  readonly jobs: Map<string, JobKnowledge>;
}

/** What is known inside one job. */
export interface JobKnowledge {
  readonly values: Map<string, Scalar>;
  readonly absent: string[];
  readonly conditional: Map<string, Conditional>;
}

export function newKnowledge(): Knowledge {
  return {
    values: new Map(),
    absent: [],
    oneOf: new Map(),
    conditional: new Map(),
    aliases: new Map(),
    jobs: new Map(),
  };
}

export function factsOf(knowledge: Knowledge): Facts {
  return {
    values: knowledge.values,
    absent: knowledge.absent,
    oneOf: knowledge.oneOf,
    conditional: knowledge.conditional,
    aliases: knowledge.aliases,
  };
}

/** The facts that hold inside each job only, as the folder wants them. */
export function jobFactsOf(knowledge: Knowledge): Map<string, Facts> {
  return new Map(
    [...knowledge.jobs].map(([id, facts]) => [
      id,
      {
        values: facts.values,
        absent: facts.absent,
        conditional: facts.conditional,
      } satisfies Facts,
    ]),
  );
}

/** The mutable facts of one job, made when first asked for. */
export function jobKnowledge(knowledge: Knowledge, id: string): JobKnowledge {
  const existing = knowledge.jobs.get(id);
  if (existing) return existing;
  const made: JobKnowledge = {
    values: new Map(),
    absent: [],
    conditional: new Map(),
  };
  knowledge.jobs.set(id, made);
  return made;
}

export type { JobResult } from './ready';

/** What a job would have reported to the jobs that need it, by the kind of run. */
export type EventResults = RemovedJob;

export const SKIPPED: JobResult = { result: 'skipped', outputs: {} };

export interface PortContext {
  /** The file name under `.github/workflows`: `checks.yml`. */
  readonly file: string;
  readonly report: Report;
  readonly knowledge: Knowledge;
  /** The jobs removed so far, with why. */
  readonly removed: Map<string, string>;
  /**
   * What a removed job would have reported, where it is not simply skipped: the readiness
   * policy judges the GitHub workflow's jobs, so a scope job that ran on a pull request
   * and was folded away is handed its result and outputs back.
   */
  readonly results: Map<string, EventResults>;
}

/** A rule changes the document, and may teach the pipeline something. */
export type Rule = (doc: Document, context: PortContext) => void;

/** What a job that left the workflow is for the jobs that needed it: skipped, with no outputs. */
export function learnRemoval(knowledge: Knowledge, id: string): void {
  knowledge.values.set(`needs.${id}.result`, 'skipped');
  knowledge.absent.push(`needs.${id}.outputs`);
}
