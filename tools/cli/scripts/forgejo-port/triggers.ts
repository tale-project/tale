/**
 * The `on:` block of a ported workflow.
 *
 * Forgejo fires `push`, `pull_request`, `schedule`, `workflow_dispatch`, `release`
 * and a handful more. It never fires `repository_dispatch`, `workflow_run` or
 * `branch_protection_rule`, and a workflow that lists them is accepted without a
 * word and simply never runs on them. So the generated file says what it will
 * really do: those events are gone, and the rest are carried over as GitHub has them.
 */

import { Scalar, YAMLMap, YAMLSeq, isMap, isSeq } from 'yaml';
import type { Document } from 'yaml';

import {
  emptyReport,
  rootOf,
  stringOf,
  type Change,
  type Report,
} from './workflow';

/** Events GitHub fires and Forgejo 15 never does: a trigger on one is dead. */
export const NEVER_FIRED = [
  'repository_dispatch',
  'workflow_run',
  'branch_protection_rule',
] as const;

/** Pull request activities Forgejo has no event for (it has no drafts and no queue). */
const UNSUPPORTED_PULL_REQUEST_TYPES = [
  'ready_for_review',
  'converted_to_draft',
  'auto_merge_enabled',
  'auto_merge_disabled',
  'enqueued',
  'dequeued',
  'locked',
  'unlocked',
] as const;

export interface TriggerOptions {
  readonly file: string;
  /** Events the workflow has on GitHub and does not have here, with why. */
  readonly dropEvents?: readonly {
    readonly name: string;
    readonly why: string;
  }[];
}

export interface TriggerResult {
  /** The events the generated workflow is triggered by: what `github.event_name` can be. */
  readonly events: readonly string[];
}

/** A flow sequence of branch names; a glob is quoted, since `*` is YAML's alias sign. */
export function flowSequence(values: readonly string[]): YAMLSeq {
  const seq = new YAMLSeq();
  seq.flow = true;
  for (const value of values) {
    const node = new Scalar(value);
    if (/[*?[\]{}!]/.test(value)) node.type = Scalar.QUOTE_SINGLE;
    seq.add(node);
  }
  return seq;
}

/** `on: push`, `on: [push, pull_request]` and the mapping form, all as a mapping. */
function normalize(doc: Document): YAMLMap {
  const root = rootOf(doc);
  const current = root.get('on');
  if (isMap(current)) return current;
  const events = new YAMLMap();
  const single = stringOf(current);
  const names =
    single !== undefined
      ? [single]
      : isSeq(current)
        ? current.items.map((item) => stringOf(item))
        : [];
  for (const name of names) if (name !== undefined) events.set(name, null);
  root.set('on', events);
  return events;
}

/**
 * Rewrite a workflow's triggers for Forgejo. Returns the events the result can
 * receive, from which every condition on `github.event_name` is decided.
 */
export function rewriteTriggers(
  doc: Document,
  options: TriggerOptions,
  report: Report = emptyReport(),
): TriggerResult {
  const { file } = options;
  const events = normalize(doc);
  const note = (rule: string, detail: string): void => {
    const change: Change = { file, at: 'on', rule, detail };
    report.changes.push(change);
  };

  for (const name of NEVER_FIRED) {
    if (events.delete(name))
      note('trigger-dead', `removed \`${name}\`: Forgejo never fires it`);
  }

  const pull = events.get('pull_request');
  if (isMap(pull)) {
    const types = pull.get('types');
    if (isSeq(types)) {
      for (let index = types.items.length - 1; index >= 0; index -= 1) {
        const type = stringOf(types.items[index]);
        if (
          type !== undefined &&
          (UNSUPPORTED_PULL_REQUEST_TYPES as readonly string[]).includes(type)
        ) {
          types.items.splice(index, 1);
          note(
            'trigger-type',
            `removed pull_request type \`${type}\`: Forgejo has no such activity`,
          );
        }
      }
      if (types.items.length === 0) pull.delete('types');
    }
  }

  for (const { name, why } of options.dropEvents ?? []) {
    if (events.delete(name))
      note('trigger-dropped', `removed \`${name}\`: ${why}`);
  }

  const dispatch = events.get('workflow_dispatch');
  if (isMap(dispatch)) {
    const inputs = dispatch.get('inputs');
    if (isMap(inputs) && inputs.has('candidate_sha')) {
      // A dispatch that exists to validate a release candidate has nothing to do here.
      events.delete('workflow_dispatch');
      note(
        'trigger-candidate',
        'removed `workflow_dispatch`: its only input was the release candidate',
      );
    }
  }

  const names = events.items.flatMap((pair) => {
    const name = stringOf(pair.key);
    return name === undefined ? [] : [name];
  });
  return { events: names };
}
