/**
 * The structural rules of the port: what exists only for GitHub is removed, and
 * what Forgejo's runner does differently is written the way it does it.
 *
 * Each rule is a function of the document that says what it did in the report. A
 * rule that finds nothing to do does nothing, so a workflow someone changes
 * tomorrow either still matches or is carried through as it is.
 */

import { Scalar, YAMLMap, isMap, isScalar, isSeq } from 'yaml';
import type { Document } from 'yaml';

import { CHECKS_MERGE_QUEUE_ONLY } from '../ci-ready';
import type { PortContext, Rule } from './context';
import {
  allOf,
  conjuncts,
  parseExpression,
  sameExpression,
} from './expression';
import {
  conditionOf,
  editCondition,
  jobIds,
  jobOf,
  removeJobs,
  stepsOf,
  stringOf,
} from './workflow';

const CI_SCOPE_ACTION = '/actions/ci-scope';

/** The scope action's own outputs that a full-scope run answers `true` to. */
const FULL_SCOPE_OUTPUTS = [
  'run',
  'full',
  'platform',
  'web',
  'docs',
  'ci_tests',
  'storybook',
] as const;

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

const PULL_REQUEST_ONLY = parseExpression(
  "github.event_name == 'pull_request'",
);
const NOT_PULL_REQUEST = parseExpression("github.event_name != 'pull_request'");

/**
 * Every pull request runs the full suite, so the machinery that decides which
 * suites a pull request owes goes: a job that only runs the scope action is
 * removed and answers "everything" to the jobs that read it, and the steps that
 * ask for the scope in the middle of another job are removed with the checkout
 * that fetched them (its "everything else" branch then applies to every event).
 */
export const fullScope: Rule = (doc, context) => {
  const { file, report, knowledge, removed } = context;
  for (const id of jobIds(doc)) {
    const job = jobOf(doc, id);
    const steps = job && stepsOf(job);
    if (!job || !steps) continue;
    const scoping = steps.items.filter(isScopeStep);
    if (scoping.length === 0) continue;
    const pure = steps.items.every(
      (step) => isScopeStep(step) || isScopeCheckout(step),
    );
    if (pure) {
      const declared = job.get('outputs');
      const names = isMap(declared)
        ? declared.items.flatMap((pair) => {
            const name = stringOf(pair.key);
            return name === undefined ? [] : [name];
          })
        : [];
      knowledge.values.set(`needs.${id}.result`, 'success');
      for (const name of names) {
        if ((FULL_SCOPE_OUTPUTS as readonly string[]).includes(name))
          knowledge.values.set(`needs.${id}.outputs.${name}`, 'true');
        else knowledge.absent.push(`needs.${id}.outputs.${name}`);
      }
      removeJobs(doc, [id]);
      removed.set(id, 'full scope: every pull request runs the whole suite');
      report.changes.push({
        file,
        at: `jobs.${id}`,
        rule: 'scope-job',
        detail:
          'removed: Forgejo runs the full suite on every pull request, so nothing decides a scope',
      });
      continue;
    }
    for (let index = steps.items.length - 1; index >= 0; index -= 1) {
      const step = steps.items[index];
      if (isScopeStep(step) || isScopeCheckout(step)) {
        steps.items.splice(index, 1);
        report.changes.push({
          file,
          at: `jobs.${id}.steps[${index}]`,
          rule: 'scope-step',
          detail:
            'removed: scope discovery is not needed when every pull request runs everything',
        });
      }
    }
    for (let index = steps.items.length - 1; index >= 0; index -= 1) {
      const step = steps.items[index];
      if (!isMap(step)) continue;
      const condition = conditionOf(step);
      if (condition === undefined) continue;
      const parsed = parseExpression(condition);
      if (sameExpression(parsed, NOT_PULL_REQUEST)) {
        step.delete('if');
        report.changes.push({
          file,
          at: `jobs.${id}.steps[${index}]`,
          rule: 'scope-step',
          detail: 'now runs for pull requests too',
        });
      } else if (sameExpression(parsed, PULL_REQUEST_ONLY)) {
        steps.items.splice(index, 1);
        report.changes.push({
          file,
          at: `jobs.${id}.steps[${index}]`,
          rule: 'scope-step',
          detail:
            'removed: it ran only for pull requests, to ask for their scope',
        });
      }
    }
  }
};

/**
 * GitHub kept the heavy suites for the merge queue; here a pull request runs
 * them, so a job that was held back for pull requests loses that condition. The
 * list of such jobs is Tale's own (`CHECKS_MERGE_QUEUE_ONLY`, which its readiness
 * evaluator and its tests already hold to the workflow).
 */
export const queueOnlyJobs: Rule = (doc, context) => {
  if (context.file !== 'checks.yml') return;
  for (const id of CHECKS_MERGE_QUEUE_ONLY) {
    const job = jobOf(doc, id);
    if (!job) continue;
    const changed = editCondition(job, (expression) =>
      allOf(
        conjuncts(expression).filter(
          (part) => !sameExpression(part, NOT_PULL_REQUEST),
        ),
      ),
    );
    if (changed)
      context.report.changes.push({
        file: context.file,
        at: `jobs.${id}`,
        rule: 'queue-only',
        detail:
          'no longer held back for pull requests: they run the full suite',
      });
  }
};

// --- services -----------------------------------------------------------------

/** Registries a job used for convenience on GitHub that the node serves under another name. */
const IMAGE_HOSTS: ReadonlyMap<string, string> = new Map([
  ['mirror.gcr.io/', 'docker.io/'],
]);

function localImage(image: string): string {
  for (const [from, to] of IMAGE_HOSTS)
    if (image.startsWith(from)) return to + image.slice(from.length);
  return image;
}

function sequenceStrings(node: unknown): string[] {
  if (!isSeq(node)) return [];
  return node.items.flatMap((item) => {
    const text = isScalar(item) ? String(item.value) : undefined;
    return text === undefined ? [] : [text];
  });
}

function shellQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** `5432:5432` or `127.0.0.1:5432:5432` becomes a loopback publish; a bare container port is refused. */
function publishPort(entry: string): string | undefined {
  const parts = entry.split(':');
  if (
    parts.length === 2 &&
    parts.every((part) => /^\d+(\/(tcp|udp))?$/.test(part))
  )
    return `127.0.0.1:${entry}`;
  if (parts.length === 3 && parts[0] === '127.0.0.1') return entry;
  return undefined;
}

function startScript(
  name: string,
  image: string,
  ports: readonly string[],
  envNames: readonly string[],
  options: string | undefined,
  command: string | undefined,
): string {
  const container = `service-${name}`;
  const lines = [
    'set -euo pipefail',
    `docker run -d --name ${shellQuote(container)} \\`,
    ...ports.map((port) => `  -p ${port} \\`),
    ...envNames.map((env) => `  -e ${env} \\`),
    ...(options ? [`  ${options} \\`] : []),
    `  ${shellQuote(image)}${command ? ` ${command}` : ''}`,
  ];
  if (options?.includes('--health-cmd')) {
    lines.push(
      'for _ in $(seq 1 90); do',
      `  status=$(docker inspect --format '{{.State.Health.Status}}' ${shellQuote(container)})`,
      '  [ "$status" = healthy ] && exit 0',
      '  if [ "$status" = unhealthy ]; then',
      `    docker logs ${shellQuote(container)}`,
      '    exit 1',
      '  fi',
      '  sleep 2',
      'done',
      `echo "::error::service ${name} never became healthy"`,
      `docker logs ${shellQuote(container)}`,
      'exit 1',
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Forgejo's runner never starts `services:` for a job that runs on a host
 * (label `:host`), so a service becomes the `docker run` it stands for, published
 * on the loopback address where the job's steps already look for it, and waited
 * for when its options define a health check. The step goes first, so the image
 * is pulled and the container started while the next steps check out the code.
 * Nothing removes the container: the runner's instance is deleted with the job.
 */
export const servicesToDockerRun: Rule = (doc, context) => {
  const { file, report } = context;
  for (const id of jobIds(doc)) {
    const job = jobOf(doc, id);
    const services = job?.get('services');
    if (!job || !isMap(services)) continue;
    const steps = stepsOf(job);
    if (!steps) continue;
    const created: YAMLMap[] = [];
    for (const entry of services.items) {
      const name = stringOf(entry.key);
      const spec = entry.value;
      if (name === undefined || !isMap(spec)) continue;
      const image = stringOf(spec.get('image'));
      if (image === undefined) continue;
      if (spec.has('credentials'))
        report.warnings.push({
          file,
          at: `jobs.${id}.services.${name}`,
          rule: 'service-credentials',
          detail: 'a registry login for a service is not carried over',
        });
      const ports = sequenceStrings(spec.get('ports')).map((entryPort) => ({
        entry: entryPort,
        publish: publishPort(entryPort),
      }));
      for (const port of ports)
        if (!port.publish)
          report.warnings.push({
            file,
            at: `jobs.${id}.services.${name}`,
            rule: 'service-port',
            detail: `port \`${port.entry}\` has no fixed host port: not published`,
          });
      const env = spec.get('env');
      const envPairs = isMap(env)
        ? env.items.flatMap((pair) => {
            const key = stringOf(pair.key);
            return key === undefined ? [] : [{ key, value: pair.value }];
          })
        : [];
      const options = stringOf(spec.get('options'))
        ?.replace(/\s+/g, ' ')
        .trim();
      const command = stringOf(spec.get('cmd'));
      const step = new YAMLMap();
      step.set('name', `Start the ${name} service`);
      if (envPairs.length > 0) {
        const stepEnv = new YAMLMap();
        for (const pair of envPairs) stepEnv.set(pair.key, pair.value);
        step.set('env', stepEnv);
      }
      const run = new Scalar(
        startScript(
          name,
          localImage(image),
          ports.flatMap((port) => (port.publish ? [port.publish] : [])),
          envPairs.map((pair) => pair.key),
          options,
          command,
        ),
      );
      run.type = Scalar.BLOCK_LITERAL;
      step.set('run', run);
      created.push(step);
    }
    steps.items.unshift(...created);
    job.delete('services');
    report.changes.push({
      file,
      at: `jobs.${id}`,
      rule: 'services',
      detail: `${created.length} service${created.length === 1 ? '' : 's'} started with docker run: the host-mode runner does not start \`services:\``,
    });
  }
};

// --- the size of a matrix -----------------------------------------------------

/** The number of jobs a plain matrix makes, or `undefined` when something decides it at run time. */
export function matrixSize(job: YAMLMap): number | undefined {
  const strategy = job.get('strategy');
  const matrix = isMap(strategy) ? strategy.get('matrix') : undefined;
  if (!isMap(matrix)) return undefined;
  let total = 1;
  for (const pair of matrix.items) {
    const key = stringOf(pair.key);
    if (key === 'include' || key === 'exclude') return undefined;
    if (!isSeq(pair.value)) return undefined;
    total *= pair.value.items.length;
  }
  return total;
}

/**
 * The runner never fills `strategy.job-total` (nor `job-index`), so a job that
 * passes `--shard=N/${{ strategy.job-total }}` would pass `--shard=N/`. The size
 * of a plain matrix is known when the file is generated.
 */
export const matrixTotals: Rule = (doc, context) => {
  for (const id of jobIds(doc)) {
    const job = jobOf(doc, id);
    if (!job) continue;
    const size = matrixSize(job);
    const known = context.knowledge.jobValues.get(id) ?? new Map();
    if (size !== undefined) known.set('strategy.job-total', size);
    context.knowledge.jobValues.set(id, known);
  }
};

// --- what has no meaning on Forgejo ------------------------------------------

/** GitHub's code-scanning upload: there is no code scanning to receive it. */
const SARIF_UPLOAD = 'github/codeql-action/upload-sarif@';

/** Deployment environments do not exist on Forgejo and the server drops the key; SARIF goes nowhere. */
export const dropWhatForgejoIgnores: Rule = (doc, context) => {
  const { file, report } = context;
  for (const id of jobIds(doc)) {
    const job = jobOf(doc, id);
    if (!job) continue;
    if (job.delete('environment'))
      report.changes.push({
        file,
        at: `jobs.${id}`,
        rule: 'environment',
        detail:
          'removed `environment:` (the server ignores it and Forgejo has no deployment environments)',
      });
    const steps = stepsOf(job);
    if (!steps) continue;
    for (let index = steps.items.length - 1; index >= 0; index -= 1) {
      if (usesOf(steps.items[index])?.startsWith(SARIF_UPLOAD)) {
        steps.items.splice(index, 1);
        report.changes.push({
          file,
          at: `jobs.${id}.steps[${index}]`,
          rule: 'sarif',
          detail:
            'removed the SARIF upload: it feeds GitHub code scanning, which Forgejo does not have',
        });
      }
    }
  }
};

// --- facts a job leaves behind ------------------------------------------------

/**
 * An output that is the empty string says nothing whether its job ran or not, so
 * the jobs that read it can be folded: build.yml's `changes` job exports the
 * release candidate's SHA, which is empty without candidates.
 */
export function learnEmptyOutputs(
  doc: Document,
  context: PortContext,
): boolean {
  let learned = false;
  for (const id of jobIds(doc)) {
    const job = jobOf(doc, id);
    const outputs = job?.get('outputs');
    if (!isMap(outputs)) continue;
    for (const pair of outputs.items) {
      const name = stringOf(pair.key);
      const value = isScalar(pair.value) ? pair.value.value : undefined;
      if (name === undefined || value !== '') continue;
      const path = `needs.${id}.outputs.${name}`;
      if (context.knowledge.values.get(path) === '') continue;
      context.knowledge.values.set(path, '');
      learned = true;
    }
  }
  return learned;
}

/** The rules every workflow goes through, in order. */
export const DEFAULT_RULES: readonly Rule[] = [
  fullScope,
  queueOnlyJobs,
  servicesToDockerRun,
  matrixTotals,
  dropWhatForgejoIgnores,
];
