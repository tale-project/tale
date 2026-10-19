/**
 * Is a generated workflow something Forgejo will accept and run?
 *
 * Two kinds of answer. Forgejo's own parser (`forgejo-runner validate`) checks the
 * keys of a file against a schema, and it is the final word: `FORGEJO_RUNNER=<binary>`
 * makes the tests run it over every generated file. This validator is what runs
 * without that Linux binary: the same key sets (read from the runner's
 * `act/schema/workflow_schema.json`, which is identical in the server's runner 12.10.2
 * and the node's 13.2.0), and the things the schema cannot say and the server and runner
 * do differently: a label the pool does not serve, a step the server cannot decode, a
 * trigger that never fires.
 */

import { isMap, isScalar, isSeq } from 'yaml';
import type { Document, YAMLMap } from 'yaml';

import { ACTIONS, externalActions } from './actions';
import { parseExpression, ExpressionError } from './expression';
import { NEVER_FIRED } from './triggers';
import {
  jobIds,
  jobOf,
  needsOf,
  readWorkflow,
  stepLists,
  stepsOf,
  stringOf,
} from './workflow';

export interface Problem {
  readonly file: string;
  readonly at: string;
  readonly message: string;
}

const WORKFLOW_KEYS = new Set([
  'on',
  'name',
  'run-name',
  'description',
  'enable-email-notifications',
  'enable-openid-connect',
  'defaults',
  'env',
  'permissions',
  'concurrency',
  'jobs',
]);

const JOB_KEYS = new Set([
  'name',
  'needs',
  'if',
  'strategy',
  'runs-on',
  'timeout-minutes',
  'cancel-timeout-minutes',
  'continue-on-error',
  'container',
  'services',
  'env',
  'environment',
  'permissions',
  'concurrency',
  'outputs',
  'defaults',
  'steps',
  'enable-openid-connect',
]);

const RUN_STEP_KEYS = new Set([
  'name',
  'id',
  'if',
  'timeout-minutes',
  'run',
  'continue-on-error',
  'env',
  'working-directory',
  'shell',
]);

const USES_STEP_KEYS = new Set([
  'name',
  'id',
  'if',
  'continue-on-error',
  'timeout-minutes',
  'uses',
  'with',
  'env',
]);

const PERMISSION_SCOPES = new Set([
  'actions',
  'attestations',
  'checks',
  'contents',
  'deployments',
  'discussions',
  'id-token',
  'issues',
  'packages',
  'pages',
  'pull-requests',
  'repository-projects',
  'security-events',
  'statuses',
]);

/** Keys of an action's `runs:` for a composite action. */
const ACTION_KEYS = new Set([
  'name',
  'description',
  'inputs',
  'runs',
  'outputs',
]);

function keysOf(map: YAMLMap): string[] {
  return map.items.flatMap((pair) => {
    const key = stringOf(pair.key);
    return key === undefined ? [] : [key];
  });
}

function expressionOf(text: string): string | undefined {
  const trimmed = text.trim();
  const wrapped = trimmed.match(/^\$\{\{([\s\S]*)\}\}$/);
  return wrapped ? wrapped[1] : trimmed.includes('${{') ? undefined : trimmed;
}

/** The runner each row of a job's matrix names under `key`. */
function matrixRunners(job: YAMLMap, key: string): string[] {
  const strategy = job.get('strategy');
  const matrix = isMap(strategy) ? strategy.get('matrix') : undefined;
  const include = isMap(matrix) ? matrix.get('include') : undefined;
  const direct = isMap(matrix) ? matrix.get(key) : undefined;
  const rows = isSeq(include)
    ? include.items.flatMap((row) =>
        isMap(row) ? [stringOf(row.get(key))] : [],
      )
    : [];
  const listed = isSeq(direct)
    ? direct.items.map((item) => stringOf(item))
    : [];
  return [...rows, ...listed].flatMap((runner) =>
    runner === undefined ? [] : [runner],
  );
}

function checkExpressions(
  doc: Document,
  file: string,
  problems: Problem[],
): void {
  for (const { at, steps } of stepLists(doc)) {
    for (const [index, step] of steps.items.entries()) {
      if (!isMap(step)) continue;
      const condition = stringOf(step.get('if'));
      if (condition !== undefined) {
        const expression = expressionOf(condition);
        try {
          if (expression !== undefined) parseExpression(expression);
        } catch (error) {
          if (!(error instanceof ExpressionError)) throw error;
          problems.push({
            file,
            at: `${at}.steps[${index}].if`,
            message: error.message,
          });
        }
      }
      const cont = step.get('continue-on-error');
      if (typeof cont === 'string' && cont.includes('${{'))
        problems.push({
          file,
          at: `${at}.steps[${index}].continue-on-error`,
          message:
            "an expression here fails the server's decoder (the field is a boolean)",
        });
    }
  }
}

export interface ValidateOptions {
  /** The runner labels the pool serves. */
  readonly labels: readonly string[];
}

/** The problems of one generated workflow. */
export function validateWorkflow(
  source: string,
  file: string,
  options: ValidateOptions,
): Problem[] {
  const problems: Problem[] = [];
  const doc = readWorkflow(source, file);
  const root = doc.contents;
  if (!isMap(root)) return [{ file, at: '', message: 'not a mapping' }];
  for (const key of keysOf(root))
    if (!WORKFLOW_KEYS.has(key))
      problems.push({
        file,
        at: key,
        message: 'Forgejo rejects this workflow key',
      });

  const on = root.get('on');
  const events = isMap(on)
    ? keysOf(on)
    : isScalar(on) || typeof on === 'string'
      ? [stringOf(on) ?? '']
      : isSeq(on)
        ? on.items.map((item) => stringOf(item) ?? '')
        : [];
  for (const event of events)
    if ((NEVER_FIRED as readonly string[]).includes(event))
      problems.push({
        file,
        at: `on.${event}`,
        message: 'Forgejo never fires this event',
      });

  const permissions = root.get('permissions');
  if (isMap(permissions))
    for (const scope of keysOf(permissions))
      if (!PERMISSION_SCOPES.has(scope))
        problems.push({
          file,
          at: `permissions.${scope}`,
          message: 'Forgejo rejects this permission scope',
        });

  const ids = jobIds(doc);
  for (const id of ids) {
    const job = jobOf(doc, id);
    if (!job) continue;
    const at = `jobs.${id}`;
    for (const key of keysOf(job))
      if (!JOB_KEYS.has(key))
        problems.push({
          file,
          at: `${at}.${key}`,
          message: 'Forgejo rejects this job key',
        });
    for (const need of needsOf(job))
      if (!ids.includes(need))
        problems.push({
          file,
          at: `${at}.needs`,
          message: `needs \`${need}\`, which is not a job: the run would fail at creation`,
        });
    if (job.has('services'))
      problems.push({
        file,
        at: `${at}.services`,
        message: 'a host-mode runner never starts services',
      });
    if (job.has('uses'))
      problems.push({
        file,
        at: `${at}.uses`,
        message: 'a reusable workflow call is not generated',
      });
    const runsOn = stringOf(job.get('runs-on'));
    const matrixKey = runsOn?.match(
      /^\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}$/,
    )?.[1];
    if (runsOn === undefined)
      problems.push({
        file,
        at: `${at}.runs-on`,
        message: 'is not one plain label',
      });
    else if (matrixKey !== undefined) {
      for (const runner of matrixRunners(job, matrixKey))
        if (!options.labels.includes(runner))
          problems.push({
            file,
            at: `${at}.runs-on`,
            message: `a matrix row runs on \`${runner}\`, which the pool does not serve`,
          });
    } else if (runsOn.includes('${{'))
      problems.push({
        file,
        at: `${at}.runs-on`,
        message: 'the label of a job must be known when the file is generated',
      });
    else if (!options.labels.includes(runsOn))
      problems.push({
        file,
        at: `${at}.runs-on`,
        message: `\`${runsOn}\` is not a label the pool serves: the runner would run it in a Docker image instead of queueing`,
      });
    const steps = stepsOf(job);
    if (!steps)
      problems.push({ file, at: `${at}.steps`, message: 'has no steps' });
  }

  for (const { at, steps } of stepLists(doc)) {
    for (const [index, step] of steps.items.entries()) {
      if (!isMap(step)) continue;
      const where = `${at}.steps[${index}]`;
      const uses = step.has('uses');
      const allowed = uses ? USES_STEP_KEYS : RUN_STEP_KEYS;
      if (uses && step.has('run'))
        problems.push({
          file,
          at: where,
          message: 'a step cannot have both uses and run',
        });
      for (const key of keysOf(step))
        if (!allowed.has(key) && !(key === 'run' && !uses))
          problems.push({
            file,
            at: `${where}.${key}`,
            message: 'Forgejo rejects this step key',
          });
      const shell = stringOf(step.get('shell'));
      if (
        shell !== undefined &&
        !shell.includes('{0}') &&
        !['bash', 'sh', 'pwsh', 'python', 'node', 'cmd', 'powershell'].includes(
          shell,
        )
      )
        problems.push({
          file,
          at: `${where}.shell`,
          message: 'a custom shell without {0} runs nothing',
        });
    }
  }

  for (const action of externalActions(doc)) {
    const disposition = ACTIONS.get(action.name);
    if (!disposition)
      problems.push({
        file,
        at: 'uses',
        message: `\`${action.name}\` is not in the action table`,
      });
    else if (disposition.kind === 'drop' || disposition.kind === 'unportable')
      problems.push({
        file,
        at: 'uses',
        message: `\`${action.name}\` cannot run on Forgejo: ${disposition.why}`,
      });
    else if (disposition.kind === 'replace')
      problems.push({
        file,
        at: 'uses',
        message: `\`${action.name}\` must be \`${disposition.to.name}\``,
      });
    else if (!/^[0-9a-f]{40}$/.test(action.ref))
      problems.push({
        file,
        at: 'uses',
        message: `\`${action.name}@${action.ref}\` is not pinned by a full commit SHA`,
      });
  }

  checkExpressions(doc, file, problems);
  return problems;
}

/** The problems of one generated composite action. */
export function validateAction(source: string, file: string): Problem[] {
  const problems: Problem[] = [];
  const doc = readWorkflow(source, file);
  const root = doc.contents;
  if (!isMap(root)) return [{ file, at: '', message: 'not a mapping' }];
  for (const key of keysOf(root))
    if (!ACTION_KEYS.has(key))
      problems.push({ file, at: key, message: 'not a key of an action file' });
  for (const action of externalActions(doc)) {
    const disposition = ACTIONS.get(action.name);
    if (
      !disposition ||
      disposition.kind === 'drop' ||
      disposition.kind === 'unportable' ||
      disposition.kind === 'replace'
    )
      problems.push({
        file,
        at: 'runs.steps',
        message: `\`${action.name}\` is not usable on Forgejo as it is`,
      });
  }
  checkExpressions(doc, file, problems);
  return problems;
}
