import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse } from 'yaml';

import { prepareSources } from './browser/prepare-sources.mjs';

const root = new URL('../../', import.meta.url);
const workflow = parse(
  await readFile(
    new URL('.github/workflows/browser-performance.yml', root),
    'utf8',
  ),
);

test('new browser diagnostics opt in from a mergeable PR without privileged triggers', () => {
  expect(Object.keys(workflow.on).toSorted()).toEqual([
    'pull_request',
    'workflow_dispatch',
  ]);
  expect(workflow.on.pull_request.types).toContain('synchronize');
  expect(workflow.on.pull_request.types).toContain('labeled');
  const job = workflow.jobs['task-board'];
  expect(job.if).toContain(
    "contains(github.event.pull_request.labels.*.name, 'benchmark:task-board')",
  );
  expect(job.if).toContain(
    'github.event.pull_request.head.repo.full_name == github.repository',
  );
  expect(job.if).toContain('github.event.pull_request.draft == false');
  expect(workflow.permissions).toEqual({ contents: 'read' });
});

test('exact source IDs and artifacts remain explicit, even on diagnostic failure', () => {
  const job = workflow.jobs['task-board'];
  expect(job.env.BASELINE_SHA).toContain('github.event.pull_request.base.sha');
  expect(job.env.CANDIDATE_SHA).toContain('github.event.pull_request.head.sha');
  expect(job['timeout-minutes']).toContain("inputs.mode == 'acceptance'");
  expect(job['timeout-minutes']).toContain("'benchmark:task-board-acceptance'");
  expect(job['timeout-minutes']).toContain('&& 90 || 45');
  const checkout = job.steps.find(
    (step: { name: string }) => step.name === 'Checkout exact candidate',
  );
  expect(checkout.with['persist-credentials']).toBe(false);
  expect(checkout.with.ref).toContain('github.event.pull_request.head.sha');
  const cleanup = job.steps.find(
    (step: { name: string }) =>
      step.name === 'Verify cleanup even after a failed phase',
  );
  const upload = job.steps.find(
    (step: { name: string }) =>
      step.name === 'Upload raw evidence and failure receipts',
  );
  expect(cleanup.if).toContain('always()');
  expect(upload.if).toBe('always()');
  expect(upload.with['if-no-files-found']).toBe('error');
  expect(job['continue-on-error']).toBeUndefined();
  for (const step of job.steps)
    expect(step['continue-on-error']).toBeUndefined();
});

test('the shared measurement deadline leaves separate bounded cleanup and upload phases', () => {
  const steps = workflow.jobs['task-board'].steps;
  const index = (name: string) =>
    steps.findIndex((step: { name: string }) => step.name === name);
  const reserve = index('Reserve image preparation within the shared deadline');
  expect(reserve).toBeGreaterThan(
    index('Install baseline and build both production bundles'),
  );
  expect(reserve).toBeLessThan(index('Setup Docker builder'));
  expect(steps[index('Setup Docker builder')]['timeout-minutes']).toBe(2);
  expect(
    steps[index('Build disposable database image')]['timeout-minutes'],
  ).toBe(5);
  expect(
    steps[index('Verify cleanup even after a failed phase')]['timeout-minutes'],
  ).toBe(3);
  expect(
    steps[index('Upload raw evidence and failure receipts')]['timeout-minutes'],
  ).toBe(6);
});

test('the coordinator polls the real backend readiness door before synthetic seeding', async () => {
  const coordinator = await readFile(
    new URL('scripts/performance/browser/inside.ts', root),
    'utf8',
  );
  const backend = await readFile(
    new URL('services/platform/backend/app.ts', root),
    'utf8',
  );
  const route =
    /await ready\('http:\/\/127\.0\.0\.1:43838([^']+)', backend\)/.exec(
      coordinator,
    )?.[1];
  expect(route).toBe('/ready');
  expect(backend).toContain(`app.get('${route}',`);
  expect(
    coordinator.indexOf("await ready('http://127.0.0.1:43838/ready', backend)"),
  ).toBeLessThan(coordinator.indexOf("join(scripts, 'seed-http.mjs')"));
});

test('runner paths are initialized at runtime and exported before any source refusal', async () => {
  const job = workflow.jobs['task-board'];
  expect(JSON.stringify(job.env)).not.toContain('runner.');
  const temporary = await mkdtemp(join(tmpdir(), 'tale-browser-bootstrap-'));
  const environment = join(temporary, 'github-env');
  const output = join(temporary, 'browser-performance');
  try {
    await expect(
      prepareSources({
        RUNNER_TEMP: temporary,
        GITHUB_ENV: environment,
        BASELINE_SHA: 'invalid',
        BENCH_EVENT_NAME: 'pull_request',
        BENCH_LABELS: JSON.stringify(['benchmark:task-board']),
      }),
    ).rejects.toThrow('Expected a full lowercase commit SHA');
    const exported = await readFile(environment, 'utf8');
    expect(exported).toContain(`BENCH_OUTPUT=${output}\n`);
    expect(exported).toMatch(/BENCH_DEADLINE_MS=\d+\n/);
    const receipt = JSON.parse(
      await readFile(join(output, 'sources.json'), 'utf8'),
    );
    expect(receipt.status).toBe('failed');
    expect(receipt.output).toBe(output);
    expect(receipt.error).toContain('Expected a full lowercase commit SHA');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('acceptance bootstrap exports its one fixed75minute deadline before failing source validation', async () => {
  const temporary = await mkdtemp(
    join(tmpdir(), 'tale-browser-acceptance-bootstrap-'),
  );
  try {
    const environment = join(temporary, 'github-env');
    const before = Date.now();
    await expect(
      prepareSources({
        RUNNER_TEMP: temporary,
        GITHUB_ENV: environment,
        BASELINE_SHA: 'invalid',
        BENCH_EVENT_NAME: 'workflow_dispatch',
        BENCH_REQUESTED_MODE: 'acceptance',
      }),
    ).rejects.toThrow('Expected a full lowercase commit SHA');
    const after = Date.now();
    const receipt = JSON.parse(
      await readFile(
        join(temporary, 'browser-performance/sources.json'),
        'utf8',
      ),
    );
    expect(receipt.mode).toBe('acceptance');
    expect(receipt.deadline - 75 * 60_000).toBeGreaterThanOrEqual(before);
    expect(receipt.deadline - 75 * 60_000).toBeLessThanOrEqual(after);
    const deadlines = [
      ...(await readFile(environment, 'utf8')).matchAll(
        /BENCH_DEADLINE_MS=(\d+)/g,
      ),
    ];
    expect(Number(deadlines.at(-1)?.[1])).toBe(receipt.deadline);
  } finally {
    await rm(temporary, { recursive: true });
  }
});
