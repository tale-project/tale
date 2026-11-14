// managed: the managed path end to end on a real node — prepare without
// Docker, a plan that changes nothing, `deploy --bundle`, `accept`,
// `observe` — then a release upgrade with one replica per role, measured
// through the edge: the in-place window of each role, from the old replica's
// withdrawal until the new one is admitted, closes, and nothing fails after
// it (design 7.1, 15.5, R3-36).

import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  cli,
  deployed,
  expectCode,
  instancesOf,
  jsonOf,
  loadLab,
  paths,
  prepared,
  receiptOf,
  record,
  sentinelOf,
  throughEdge,
  until,
  bootstrapped,
  deploymentEnvironment,
} from '../harness';
import { lengthOf, startLoad, windowsOf } from '../load';

setDefaultTimeout(90 * 60_000);
const lab = loadLab();
const at = paths(lab);

/** The CLI revision and the orchestrator commit a bundle records. */
function pinsOf(bundle: string): { cliRef: string; deploymentRef: string } {
  const manifest = JSON.parse(
    readFileSync(join(bundle, 'deployment.json'), 'utf8'),
  ) as { cli: { revision: string }; deploymentRef?: string };
  return {
    cliRef: manifest.cli.revision,
    deploymentRef: manifest.deploymentRef ?? '',
  };
}

/** A service answers through the edge as a visitor of the origin sees it. */
async function answers(path: string): Promise<number> {
  const target = throughEdge(lab, path);
  const response = await fetch(target.url, {
    headers: target.headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  await response.arrayBuffer();
  return response.status;
}

const TARGETS = {
  platform: '/api/health',
  'backend-api': '/api/health/ready',
};
/** The platform's start period bounds the window (design 7.1), with room for
 * the image pull of a cold node. */
const WINDOW_BOUND_MS = 300_000;

describe('managed', () => {
  test('prepare reads every image from the registry, with no Docker', () => {
    const started = performance.now();
    const bundle = prepared(lab, 1);
    const runtime = JSON.parse(
      readFileSync(join(bundle, 'runtime', 'runtime.json'), 'utf8'),
    ) as {
      runtime: string;
      revision: string;
      images: { repository: string; reference: string }[];
    };
    expect(runtime.runtime).toBe('incus');
    expect(runtime.revision).toBe(lab.revision);
    for (const image of runtime.images)
      expect(image.reference).toMatch(/@sha256:[a-f0-9]{64}$/);
    const stack = readFileSync(
      join(bundle, 'runtime', 'incus-stack.json'),
      'utf8',
    );
    expect(stack).not.toContain(sentinelOf(lab));
    record(lab, 'managed', {
      prepareMs: Math.round(performance.now() - started),
    });
  });

  test('a plan of the first deploy creates everything and changes nothing', () => {
    bootstrapped(lab);
    if (receiptOf(lab) !== null) return; // a re-run on a deployed lab
    const run = expectCode(
      cli(lab, [
        '--json',
        'deploy',
        '--bundle',
        prepared(lab, 1),
        '--plan-only',
      ]),
      0,
    );
    expect(JSON.stringify(jsonOf(run))).toContain('create');
    expect(instancesOf(lab)).toEqual([]);
  });

  test('deploy --bundle brings the stack up, and it serves through the edge', async () => {
    const started = performance.now();
    deployed(lab);
    record(lab, 'managed', {
      firstDeployMs: Math.round(performance.now() - started),
    });
    expect(receiptOf(lab)?.phase).toBe('ready');
    const instances = instancesOf(lab);
    expect(instances.length).toBeGreaterThan(10);
    for (const instance of instances)
      expect(`${instance.name} ${instance.status}`).toBe(
        `${instance.name} Running`,
      );
    for (const path of Object.values(TARGETS))
      expect(
        await until(`${path} through the edge`, async () =>
          (await answers(path)) === 200 ? 200 : undefined,
        ),
      ).toBe(200);
  });

  // accept reads the release from the declared origin over HTTPS; the lab's
  // origin name resolves nowhere and no TLS terminator fronts its edge, and on
  // Incus there is no private-origin container to dial instead (README.md,
  // "What the lab cannot prove yet"). `bun test --todo` runs it.
  test.todo('accept proves the release from what runs', () => {
    const bundle = prepared(lab, 1);
    const pins = pinsOf(bundle);
    const run = expectCode(
      cli(lab, [
        '--json',
        'deploy',
        'accept',
        '--bundle',
        bundle,
        '--cli-ref',
        pins.cliRef,
        '--deployment-ref',
        pins.deploymentRef,
        '--expected-version',
        lab.version,
      ]),
      0,
    );
    record(lab, 'managed', { acceptMs: run.ms });
  });

  // observe stops at its filesystem inventory on Incus: a mount's source is a
  // volume of the pool, not a host path it can measure (README.md, "Known
  // findings"). `bun test --todo` runs it.
  test.todo('observe reads the deployment without changing it', () => {
    const pins = pinsOf(prepared(lab, 1));
    const machineId = readFileSync('/etc/machine-id', 'utf8').trim();
    const run = cli(
      lab,
      [
        '--json',
        'deploy',
        'observe',
        '--spec',
        at.spec(1),
        '--cli-ref',
        pins.cliRef,
        '--deployment-ref',
        pins.deploymentRef,
        '--machine-id-sha256',
        createHash('sha256').update(machineId).digest('hex'),
      ],
      {
        input: JSON.stringify({ environment: deploymentEnvironment(lab) }),
      },
    );
    record(lab, 'managed', { observeMs: run.ms, observeExit: run.code });
    expectCode(run, 0);
  });

  test('a release upgrade is planned with its in-place window, and refused without the recovery snapshot Incus cannot take yet', () => {
    deployed(lab);
    const next = prepared(lab, 2);
    const plan = expectCode(
      cli(lab, ['deploy', '--bundle', next, '--plan-only']),
      0,
    );
    expect(`${plan.stdout}${plan.stderr}`).toContain(
      'backend-api and platform are replaced in place with one replica',
    );
    const before = instancesOf(lab).map(
      (instance) => `${instance.name} ${instance.createdAt} ${instance.status}`,
    );
    const run = expectCode(cli(lab, ['deploy', '--bundle', next, '--yes']), 3);
    expect(`${run.stdout}${run.stderr}`).toContain(
      'A changed existing deployment on Incus needs a recovery snapshot',
    );
    expect(
      instancesOf(lab).map(
        (instance) =>
          `${instance.name} ${instance.createdAt} ${instance.status}`,
      ),
    ).toEqual(before);
    expect(receiptOf(lab)?.revision).toBe(lab.revision);
  });

  // The upgrade itself waits for the recovery snapshot on Incus (the next
  // milestone's snapshots); then `bun test --todo` is no longer needed.
  test.todo('a release upgrade replaces each role in place, and its window closes at the new replica', async () => {
    deployed(lab);
    const next = prepared(lab, 2);
    const plan = expectCode(
      cli(lab, ['deploy', '--bundle', next, '--plan-only']),
      0,
    );
    expect(`${plan.stdout}${plan.stderr}`).toContain('replaced in place');
    const before = new Map(
      instancesOf(lab).map((instance) => [instance.name, instance.createdAt]),
    );

    const load = startLoad(
      Object.entries(TARGETS).map(([name, path]) =>
        Object.assign({ name }, throughEdge(lab, path)),
      ),
      { intervalMs: 100 },
    );
    const run = cli(lab, ['deploy', '--bundle', next, '--yes']);
    // A short tail after the deploy, so a window that closes only then is seen.
    await Bun.sleep(5_000);
    const samples = await load.stop();
    expectCode(run, 0);

    const windows = windowsOf(samples);
    record(lab, 'managed', {
      upgradeMs: run.ms,
      upgradeSamples: samples.length,
      upgradeWindows: windows.map((window) => ({
        target: window.target,
        fromMs: Math.round(window.from),
        lengthMs:
          window.to === null ? null : Math.round(window.to - window.from),
        failures: window.failures,
      })),
    });
    expect(receiptOf(lab)?.phase).toBe('ready');
    // Each window closed: the role served again once its new replica was
    // admitted, within the bound the start period sets.
    for (const window of windows) {
      expect(window.to).not.toBeNull();
      expect(lengthOf(window) ?? Infinity).toBeLessThan(WINDOW_BOUND_MS);
    }
    // Once the deploy finished, every answer through the edge was a success.
    const finished = (samples.at(-1)?.at ?? 0) - 5_000;
    expect(
      samples.filter((sample) => sample.at > finished && !sample.ok),
    ).toEqual([]);
    // The switched roles were replaced; the data services were not.
    const after = new Map(
      instancesOf(lab).map((instance) => [instance.name, instance.createdAt]),
    );
    expect(after.get('db')).toBe(before.get('db'));
    expect(after.get('platform-1')).not.toBe(before.get('platform-1'));
  });
});
