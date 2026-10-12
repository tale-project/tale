/**
 * Port one workflow: the pipeline.
 *
 * The same few steps run for every workflow, in this order, and a rule that finds
 * nothing to do does nothing:
 *
 *   1. the triggers say which events the generated file can receive;
 *   2. structural rules remove what exists only for GitHub (scope discovery,
 *      candidate validation) and rewrite what Forgejo does differently;
 *   3. every condition and value is folded by what is now known, and jobs that can
 *      never run are removed, which makes them a fact for the jobs that needed
 *      them, until nothing changes.
 *
 * What the pipeline does not touch is carried through as it was written.
 */

import {
  factsOf,
  jobFactsOf,
  learnRemoval,
  newKnowledge,
  type PortContext,
  type Rule,
} from './context';
import { DEFAULT_RULES, learnEmptyOutputs } from './rules';
import { rewriteTriggers, type TriggerOptions } from './triggers';
import {
  emptyReport,
  foldWorkflow,
  jobIds,
  readWorkflow,
  removeJobs,
  writeWorkflow,
  type Report,
  type Workflow,
} from './workflow';

export interface PortOptions {
  readonly triggers?: Partial<TriggerOptions>;
  /** Rules that run before folding, in order. */
  readonly rules?: readonly Rule[];
}

export interface PortedWorkflow {
  readonly text: string;
  readonly jobs: readonly string[];
  readonly removed: ReadonlyMap<string, string>;
  readonly events: readonly string[];
}

export function portWorkflow(
  source: string,
  file: string,
  report: Report = emptyReport(),
  options: PortOptions = {},
): PortedWorkflow {
  const doc: Workflow = readWorkflow(source, file);
  const knowledge = newKnowledge();
  const removed = new Map<string, string>();
  const context: PortContext = { file, report, knowledge, removed };

  const triggers = rewriteTriggers(doc, { file, ...options.triggers }, report);
  knowledge.oneOf.set('github.event_name', [...triggers.events]);
  knowledge.absent.push(
    'github.event.client_payload',
    'github.event.merge_group',
    'inputs.candidate_sha',
    'github.event.inputs.candidate_sha',
  );

  for (const rule of options.rules ?? DEFAULT_RULES) rule(doc, context);

  // A removed job is a fact for the jobs that needed it, and an empty output is a fact for
  // the jobs that read it: fold until neither teaches anything new.
  for (let round = 0; round < 32; round += 1) {
    const dead = foldWorkflow(doc, {
      file,
      facts: factsOf(knowledge),
      jobFacts: jobFactsOf(knowledge),
      report,
    });
    const learned = learnEmptyOutputs(doc, context);
    if (dead.length === 0 && !learned) break;
    removeJobs(doc, dead);
    for (const id of dead) {
      removed.set(id, 'its condition can never hold on Forgejo');
      learnRemoval(knowledge, id);
      report.changes.push({
        file,
        at: `jobs.${id}`,
        rule: 'job-removed',
        detail: 'removed: it can never run on Forgejo',
      });
    }
  }

  return {
    text: writeWorkflow(doc),
    jobs: jobIds(doc),
    removed,
    events: triggers.events,
  };
}
