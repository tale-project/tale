/**
 * The scope of a run: which suites it owes.
 *
 * On GitHub a `ci-scope` step answers that: a pull request owes the suites its paths
 * touch, every other event owes everything. Which files a pull request touches takes
 * GitHub's API, so on Forgejo a pull request owes everything too, and lands on its own
 * with its full suite. The answers are then a function of the event, so the port does
 * not run the step: it teaches the folder what each output is for a pull request and
 * for anything else, and the conditions that read it fold into conditions on the event.
 *
 * The one thing it does not carry over is Security's path filter: Security runs on
 * every pull request, which costs a few runner-minutes for two lockfile scans.
 */

import { isMap, isScalar } from 'yaml';

import { BUILD_FILTERS, E2E_SERVICES, buildScope, e2eScope } from '../ci-ready';
import {
  jobKnowledge,
  type JobResult,
  type Knowledge,
  type Rule,
} from './context';
import {
  ExpressionError,
  contextPath,
  parseExpression,
  parseTemplate,
} from './expression';
import {
  conditionOf,
  foldCondition,
  jobIds,
  jobOf,
  removeJobs,
  stepsOf,
  stringOf,
} from './workflow';

const CI_SCOPE_ACTION = '/actions/ci-scope';

/** Every output the scope action declares. */
const OUTPUTS = [
  'run',
  'full',
  'changes',
  'ci_tests',
  'storybook',
  'platform',
  'web',
  'docs',
] as const;

type Event = 'pull_request' | 'push';
const EVENTS: readonly Event[] = ['pull_request', 'push'];

/** `push` stands for every event that is not a pull request: a push, a schedule, a dispatch. */
const PULL_REQUEST = parseExpression("github.event_name == 'pull_request'");

function usesOf(step: unknown): string | undefined {
  return isMap(step) ? stringOf(step.get('uses')) : undefined;
}

function isScopeStep(step: unknown): boolean {
  return usesOf(step)?.includes(CI_SCOPE_ACTION) === true;
}

/** A checkout that only fetches the scope action and its policy. */
function isScopeCheckout(step: unknown): boolean {
  if (!isMap(step) || !usesOf(step)?.startsWith('actions/checkout@'))
    return false;
  const inputs = step.get('with');
  const sparse = isMap(inputs)
    ? stringOf(inputs.get('sparse-checkout'))
    : undefined;
  return sparse?.includes('ci-scope/action.yml') === true;
}

function inputText(inputs: unknown, name: string): string | undefined {
  if (!isMap(inputs)) return undefined;
  const node = inputs.get(name, true);
  const value = isScalar(node) ? node.value : node;
  return value === null || value === undefined ? undefined : String(value);
}

/** What the scope action answers when the run owes everything, as every run here does. */
function fullOutputs(filter: string): Record<string, string> {
  const outputs: Record<string, string> = { run: 'true', full: 'true' };
  if (filter === 'build')
    Object.assign(
      outputs,
      buildScope(
        Object.fromEntries(BUILD_FILTERS.map((name) => [name, 'true'])),
        true,
      ),
    );
  if (filter === 'e2e')
    Object.assign(
      outputs,
      e2eScope(
        Object.fromEntries(E2E_SERVICES.map((name) => [name, 'true'])),
        true,
      ),
    );
  return outputs;
}

/** Whether something with this condition runs for this kind of run; `undefined` when more than the event decides. */
function ranOn(
  condition: string | undefined,
  event: Event,
): boolean | undefined {
  if (condition === undefined) return true;
  try {
    const outcome = foldCondition(condition, {
      values: new Map([['github.event_name', event]]),
    });
    if (outcome.kind === 'always') return true;
    if (outcome.kind === 'never') return false;
    return undefined;
  } catch (error) {
    if (error instanceof ExpressionError) return undefined;
    throw error;
  }
}

/** Teach the folder a path that holds one string for a pull request and another for anything else. */
function teach(
  knowledge: {
    values: Knowledge['values'];
    conditional: Knowledge['conditional'];
  },
  path: string,
  values: Record<Event, string>,
): void {
  if (values.pull_request === values.push)
    knowledge.values.set(path, values.push);
  else
    knowledge.conditional.set(path, {
      when: PULL_REQUEST,
      ifTrue: values.pull_request,
      ifFalse: values.push,
    });
}

/** The step output a job output passes on: `${{ steps.scope.outputs.run }}`. */
function stepOutputPath(value: unknown): string | undefined {
  const text = stringOf(value);
  if (text === undefined) return undefined;
  try {
    const parts = parseTemplate(text);
    const only = parts.length === 1 ? parts[0] : undefined;
    if (only?.kind !== 'expr') return undefined;
    const path = contextPath(only.expr);
    return path?.startsWith('steps.') ? path : undefined;
  } catch (error) {
    if (error instanceof ExpressionError) return undefined;
    throw error;
  }
}

export const ciScope: Rule = (doc, context) => {
  const { file, report, knowledge, removed, results } = context;
  const warn = (at: string, detail: string): void => {
    report.warnings.push({ file, at, rule: 'scope', detail });
  };

  for (const id of jobIds(doc)) {
    const job = jobOf(doc, id);
    const steps = job && stepsOf(job);
    if (!job || !steps) continue;
    const scoping = steps.items.filter(isScopeStep);
    if (scoping.length === 0) continue;
    const at = `jobs.${id}`;
    const inJob = jobKnowledge(knowledge, id);

    // What each scope step reports where it runs, by the path a later step or job reads.
    const reported = new Map<string, Record<Event, string>>();
    let understood = true;
    for (const step of scoping) {
      if (!isMap(step)) continue;
      const stepId = stringOf(step.get('id'));
      const inputs = step.get('with');
      const filter = inputText(inputs, 'filter');
      if (stepId === undefined || filter === undefined) {
        warn(at, 'a scope step with no id or no filter: left as it is');
        understood = false;
        continue;
      }
      const answers = fullOutputs(filter);
      const ran = EVENTS.map((event) => ranOn(conditionOf(step), event));
      if (ran.some((value) => value === undefined)) {
        warn(
          at,
          `the scope step \`${stepId}\` runs on more than the event decides: left as it is`,
        );
        understood = false;
        continue;
      }
      for (const name of OUTPUTS) {
        const values = Object.fromEntries(
          EVENTS.map((event, index) => [
            event,
            ran[index] ? (answers[name] ?? '') : '',
          ]),
        ) as Record<Event, string>;
        reported.set(`steps.${stepId}.outputs.${name}`, values);
        teach(inJob, `steps.${stepId}.outputs.${name}`, values);
      }
    }
    if (!understood) continue;

    const pure = steps.items.every(
      (step) =>
        (isScopeStep(step) || isScopeCheckout(step)) &&
        isMap(step) &&
        conditionOf(step) === undefined,
    );
    if (!pure) {
      for (let index = steps.items.length - 1; index >= 0; index -= 1) {
        const step = steps.items[index];
        if (!isScopeStep(step) && !isScopeCheckout(step)) continue;
        steps.items.splice(index, 1);
        report.changes.push({
          file,
          at: `${at}.steps[${index}]`,
          rule: 'scope-step',
          detail:
            'removed: what the step answers is a function of the event, so the conditions that read it say so',
        });
      }
      continue;
    }

    // A job that only asks for the scope: its result and outputs are functions of the event too.
    const jobRan = EVENTS.map((event) => ranOn(conditionOf(job), event));
    if (jobRan.some((value) => value === undefined)) {
      warn(
        at,
        'a scope job that runs on more than the event decides: left as it is',
      );
      continue;
    }
    const declared = job.get('outputs');
    const outputPaths = new Map<string, string>();
    if (isMap(declared)) {
      for (const pair of declared.items) {
        const name = stringOf(pair.key);
        const path = stepOutputPath(pair.value);
        if (name !== undefined && path !== undefined && reported.has(path))
          outputPaths.set(name, path);
      }
    }
    const perEvent = Object.fromEntries(
      EVENTS.map((event, index): [Event, JobResult] => {
        const outputs: Record<string, string> = {};
        for (const [name, path] of outputPaths)
          outputs[name] = jobRan[index]
            ? (reported.get(path)?.[event] ?? '')
            : '';
        return [
          event,
          { result: jobRan[index] ? 'success' : 'skipped', outputs },
        ];
      }),
    ) as Record<Event, JobResult>;
    teach(knowledge, `needs.${id}.result`, {
      pull_request: perEvent.pull_request.result,
      push: perEvent.push.result,
    });
    for (const name of outputPaths.keys())
      teach(knowledge, `needs.${id}.outputs.${name}`, {
        pull_request: perEvent.pull_request.outputs[name] ?? '',
        push: perEvent.push.outputs[name] ?? '',
      });
    knowledge.jobs.delete(id);
    removeJobs(doc, [id]);
    removed.set(
      id,
      'scope: what it reports is a function of the event, so the jobs that read it say so',
    );
    results.set(id, perEvent.pull_request);
    report.changes.push({
      file,
      at,
      rule: 'scope-job',
      detail:
        'removed: what it reports is a function of the event, and a pull request owes everything',
    });
  }
};
