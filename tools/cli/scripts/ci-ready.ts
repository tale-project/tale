/** Pure native-workflow result policy. Loaded by pinned github-script/Node 24
 * without installing workspace dependencies; tests hold every ID to the YAML. */
export const CI_JOBS = {
  checks: [
    'candidate-source',
    'format',
    'lint',
    'typecheck',
    'build',
    'test',
    'test-ui',
    'test-ui-shards',
    'performance',
    'knip',
    'test-browser',
    'integration-scope',
    'backend-integration',
    'candidate-gate',
  ],
  commitlint: ['candidate-source', 'commitlint', 'candidate-gate'],
  sast: ['candidate-source', 'sast', 'candidate-gate'],
  security: [
    'candidate-source',
    'pr-scope',
    'bun-audit',
    'trivy-fs',
    'candidate-gate',
  ],
  cli: [
    'candidate-source',
    'pr-scope',
    'prepare',
    'build',
    'release',
    'candidate-gate',
  ],
  e2e: [
    'candidate-source',
    'pr-scope',
    'scope',
    'build',
    'e2e',
    'static-sites',
    'candidate-gate',
  ],
  build: [
    'candidate-source',
    'pr-scope',
    'changes',
    'build',
    'smoke-test',
    'smoke-test-fork',
    'web-test',
    'docs-test',
    'ui-docs-test',
    'ai-gateway-test',
    'image-validate',
    'image-validate-fork',
    'vulnerability-scan',
    'storybook',
    'candidate-gate',
  ],
} as const;

export const CI_CONTEXTS = {
  checks: 'CI ready (Checks)',
  commitlint: 'CI ready (Commitlint)',
  sast: 'CI ready (SAST)',
  security: 'CI ready (Security)',
  cli: 'CI ready (CLI)',
  e2e: 'CI ready (E2E)',
  build: 'CI ready (Build)',
} as const;

/** Release receipts keep their existing required graph. New ordinary-only
 * checks may be present in a candidate job listing solely as deliberate skips. */
export function ordinaryOnlyJob(workflow: string, name: string): boolean {
  if (!Object.hasOwn(CI_CONTEXTS, workflow)) return false;
  return (
    name === CI_CONTEXTS[workflow as keyof typeof CI_CONTEXTS] ||
    (name === 'PR scope' &&
      ['build', 'e2e', 'cli', 'security'].includes(workflow))
  );
}

export const COMPOSE_SERVICES = [
  'db',
  'platform',
  'proxy',
  'sandbox-llm-gateway',
  'sandbox',
  'sandbox-egress',
  'sandbox-buildkitd',
  'sandbox-runtime',
] as const;
export const BUILD_SERVICES = [
  ...COMPOSE_SERVICES,
  'web',
  'docs',
  'ui-docs',
  'ai-gateway',
] as const;
export const BUILD_FILTERS = [
  ...BUILD_SERVICES,
  'ci_tests',
  'storybook',
  'image_inputs',
] as const;

/** Export only recognized native service/pseudo-filter IDs from one discovery. */
export function buildScope(filters: unknown, full: boolean) {
  const values = object(filters, 'Build filters');
  if (!sameSet(Object.keys(values), BUILD_FILTERS))
    throw new Error('Incomplete Build filters');
  const selected = BUILD_FILTERS.filter((name) => scopeBoolean(values[name]));
  const changes =
    full || selected.includes('image_inputs')
      ? BUILD_FILTERS.filter((name) => name !== 'image_inputs')
      : selected;
  return {
    changes: JSON.stringify(changes),
    ci_tests: String(changes.includes('ci_tests')),
    storybook: String(changes.includes('storybook')),
  };
}
export const E2E_SERVICES = ['platform', 'web', 'docs'] as const;

/** Preserve the service policy from the same validated frozen PR discovery. */
export function e2eScope(filters: unknown, full: boolean) {
  const values = object(filters, 'E2E filters');
  if (!sameSet(Object.keys(values), E2E_SERVICES))
    throw new Error('Incomplete E2E filters');
  return Object.fromEntries(
    E2E_SERVICES.map((name) => {
      const selected = scopeBoolean(values[name]);
      return [name, String(full || selected)];
    }),
  );
}

type Workflow = keyof typeof CI_JOBS;
type ObjectValue = Record<string, unknown>;

function object(value: unknown, label: string): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as ObjectValue;
}
function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value))
    throw new Error('Expected a full source SHA');
  return value;
}
function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}
export function scopeBoolean(value: unknown): boolean {
  if (value !== 'true' && value !== 'false')
    throw new Error('Scope must explicitly be true or false');
  return value === 'true';
}
function changedFiles(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error('Invalid changed_files count');
  return value as number;
}
function identity(value: unknown) {
  const pr = object(value, 'Pull request');
  return {
    base: sha(object(pr.base, 'PR base').sha),
    head: sha(object(pr.head, 'PR head').sha),
    count: changedFiles(pr.changed_files),
  };
}

/** Mutable API discovery cannot prove a frozen event irrelevant after its source
 * moves, its count changes, or the API file-list boundary is reached. */
export function requiresFullScope(frozen: unknown, current: unknown): boolean {
  const a = identity(frozen);
  const b = identity(current);
  return (
    a.base !== b.base ||
    a.head !== b.head ||
    a.count !== b.count ||
    a.count >= 3000 ||
    b.count >= 3000
  );
}

export function validateScope({
  frozen,
  before,
  after,
  touched,
  guard,
  counted,
  files,
  added,
  deleted,
}: {
  frozen: unknown;
  before: unknown;
  after: unknown;
  touched: unknown;
  guard: unknown;
  counted: unknown;
  files: unknown;
  added: unknown;
  deleted: unknown;
}) {
  // Validate the action's outputs even when a later identity check widens scope.
  const selected = scopeBoolean(touched);
  const sharedGuard = scopeBoolean(guard);
  const hasAdded = scopeBoolean(added);
  const hasDeleted = scopeBoolean(deleted);
  if (typeof counted !== 'string' || !/^\d+$/.test(counted))
    throw new Error('Missing complete file count');
  const count = Number(counted);
  if (!Number.isSafeInteger(count))
    throw new Error('Invalid complete file count');
  if (typeof files !== 'string') throw new Error('Missing changed paths');
  const paths: unknown = JSON.parse(files);
  if (
    !Array.isArray(paths) ||
    paths.length !== count ||
    paths.some(
      (path) =>
        typeof path !== 'string' ||
        path === '' ||
        path.startsWith('/') ||
        path.split('/').includes('..') ||
        /[\\\u0000-\u001f]/.test(path),
    ) ||
    new Set(paths).size !== count
  )
    throw new Error('Invalid or duplicated changed paths');
  const full =
    sharedGuard ||
    // Pinned paths-filter expands each rename into added+deleted paths. A
    // matching expanded count cannot prove API row completeness in this case.
    (hasAdded && hasDeleted) ||
    requiresFullScope(frozen, before) ||
    requiresFullScope(frozen, after);
  if (full) return { run: true, full: true };
  if (count !== identity(frozen).count)
    throw new Error('Incomplete changed-file discovery');
  return { run: full || selected, full };
}

function strings(
  value: unknown,
  allowed: readonly string[],
  label: string,
): string[] {
  if (typeof value !== 'string') throw new Error(`${label} is missing`);
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) => typeof item !== 'string' || !allowed.includes(item),
    ) ||
    new Set(parsed).size !== parsed.length
  )
    throw new Error(`${label} is not a valid service set`);
  return parsed as string[];
}
function sameSet(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((value) => b.includes(value));
}

export function evaluateReadiness(input: {
  workflow: string;
  event: string;
  payload: unknown;
  needs: unknown;
  source: string;
}) {
  const rows: { job: string; result: string; policy: string }[] = [];
  const reasons: string[] = [];
  try {
    if (!Object.hasOwn(CI_JOBS, input.workflow))
      throw new Error('Unknown validation workflow');
    const workflow = input.workflow as Workflow;
    const payload = object(input.payload, 'Event');
    const needs = object(input.needs, 'Native needs');
    const ids = CI_JOBS[workflow];
    if (!sameSet(Object.keys(needs), ids))
      throw new Error('Native needs must cover every classified job exactly');
    sha(input.source);
    let fork = false;
    if (input.event === 'pull_request') {
      const pr = object(payload.pull_request, 'Pull request');
      identity(pr);
      fork = boolean(
        object(object(pr.head, 'PR head').repo, 'PR repository').fork,
        'Fork',
      );
      if (boolean(pr.draft, 'Draft'))
        reasons.push('Draft pull request is held, not ready for merge');
    } else if (input.event === 'merge_group') {
      const group = object(payload.merge_group, 'Merge group');
      sha(group.base_sha);
      if (sha(group.head_sha) !== input.source)
        throw new Error('Merge group source does not match the checkout');
    } else
      throw new Error(
        'Readiness is only defined for pull_request and merge_group',
      );

    const results = new Map<string, string>();
    const outputs = new Map<string, ObjectValue>();
    for (const id of ids) {
      const job = object(needs[id], id);
      if (
        typeof job.result !== 'string' ||
        !['success', 'failure', 'cancelled', 'skipped'].includes(job.result)
      )
        throw new Error(`${id}: unknown native result`);
      results.set(id, job.result);
      outputs.set(id, object(job.outputs ?? {}, `${id} outputs`));
    }
    const requireResult = (
      id: string,
      expected: 'success' | 'skipped',
      policy = expected === 'success' ? 'required' : 'not applicable',
    ) => {
      const result = results.get(id)!;
      rows.push({ job: id, result, policy });
      if (result !== expected)
        reasons.push(`${id}: expected ${expected}, got ${result}`);
    };
    requireResult('candidate-source', 'skipped', 'candidate event only');
    requireResult('candidate-gate', 'skipped', 'candidate event only');
    if (workflow === 'cli')
      requireResult('release', 'skipped', 'manual publication only');

    let applicable = true;
    let full = input.event === 'merge_group';
    if (ids.some((id) => id === 'pr-scope')) {
      if (input.event === 'pull_request') {
        requireResult('pr-scope', 'success', 'validated PR scope');
        applicable = scopeBoolean(outputs.get('pr-scope')!.run);
        full = scopeBoolean(outputs.get('pr-scope')!.full);
        if (full && !applicable)
          throw new Error('Full scope cannot exclude validation');
      } else
        requireResult('pr-scope', 'skipped', 'merge group runs full coverage');
    }
    if (workflow === 'checks') {
      requireResult('integration-scope', 'success', 'validated backend scope');
      const run = scopeBoolean(outputs.get('integration-scope')!.run);
      if (full && !run)
        throw new Error('Merge group must run backend integration');
      requireResult('backend-integration', run ? 'success' : 'skipped');
    }
    if (workflow === 'e2e' && applicable) {
      requireResult('scope', 'success', 'validated E2E service scope');
      const discovered = outputs.get('scope')!;
      const platform = scopeBoolean(discovered.platform);
      const services = strings(
        discovered.static_services,
        ['web', 'docs'],
        'static_services',
      );
      if (full && (!platform || !sameSet(services, ['web', 'docs'])))
        throw new Error('Full E2E scope lost service coverage');
      if (!platform && services.length === 0)
        throw new Error('Applicable E2E scope must select a service');
      requireResult('build', platform ? 'success' : 'skipped');
      requireResult('e2e', platform ? 'success' : 'skipped');
      requireResult(
        'static-sites',
        services.length > 0 ? 'success' : 'skipped',
      );
    }
    if (workflow === 'build' && applicable) {
      requireResult('changes', 'success', 'validated service scope');
      const discovered = outputs.get('changes')!;
      const services = strings(discovered.services, BUILD_SERVICES, 'services');
      const scans = strings(
        discovered.scannable_services,
        COMPOSE_SERVICES,
        'scannable_services',
      );
      const ci = scopeBoolean(discovered.ci_tests);
      const storybook = scopeBoolean(discovered.storybook);
      if (full && (!sameSet(services, BUILD_SERVICES) || !ci || !storybook))
        throw new Error('Full Build scope lost service coverage');
      const expectedScans = services.filter((service) =>
        (COMPOSE_SERVICES as readonly string[]).includes(service),
      );
      if (!sameSet(scans, expectedScans))
        throw new Error('Image scan scope differs from discovered services');
      const compose = scopeBoolean(discovered.stack);
      if (compose !== (ci || expectedScans.length > 0))
        throw new Error(
          'Platform stack scope differs from discovered services',
        );
      requireResult('build', compose && !fork ? 'success' : 'skipped');
      for (const job of ['smoke-test', 'image-validate']) {
        requireResult(job, compose && !fork ? 'success' : 'skipped');
        requireResult(`${job}-fork`, compose && fork ? 'success' : 'skipped');
      }
      for (const service of ['web', 'docs', 'ui-docs', 'ai-gateway'])
        requireResult(
          `${service}-test`,
          services.includes(service) ? 'success' : 'skipped',
        );
      requireResult('storybook', storybook ? 'success' : 'skipped');
      if (scans.length > 0 && !fork) {
        const result = results.get('vulnerability-scan')!;
        rows.push({
          job: 'vulnerability-scan',
          result,
          policy: 'advisory; native aggregate is not proof of scanner findings',
        });
        if (!['success', 'failure'].includes(result))
          reasons.push(
            `vulnerability-scan: expected completed advisory execution, got ${result}`,
          );
      } else requireResult('vulnerability-scan', 'skipped');
    }
    for (const id of ids) {
      if (!rows.some((row) => row.job === id))
        requireResult(id, applicable ? 'success' : 'skipped');
    }
  } catch (error) {
    reasons.push(
      error instanceof Error ? error.message : 'Invalid readiness input',
    );
  }
  return { passed: reasons.length === 0, reasons, jobs: rows };
}
