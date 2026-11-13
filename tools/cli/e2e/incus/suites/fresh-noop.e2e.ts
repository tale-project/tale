// fresh and noop: on a stack the CLI applied, the plan of the same bundle is
// empty, and a second `deploy --bundle` changes nothing on the node — no
// instance is recreated, restarted or reconfigured (design 15.5).

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import {
  cli,
  currentRelease,
  deployed,
  expectCode,
  incus,
  instancesOf,
  loadLab,
  planOf,
  prepared,
  receiptOf,
  record,
} from '../harness';

setDefaultTimeout(60 * 60_000);
const lab = loadLab();

/** What a recreation, a restart or a reconfiguration would change. */
function fingerprint(): Record<string, string> {
  return Object.fromEntries(
    instancesOf(lab).map((instance) => {
      const state = JSON.parse(
        incus(lab, [
          'query',
          `/1.0/instances/${instance.name}/state?project=${lab.name}`,
        ]).stdout,
      ) as { pid: number };
      return [
        instance.name,
        `${instance.createdAt} ${instance.status} pid=${state.pid} ${instance.config['volatile.last_state.power'] ?? ''}`,
      ];
    }),
  );
}

describe('fresh-noop', () => {
  test('the plan of the bundle the stack runs is empty', () => {
    deployed(lab);
    const bundle = prepared(lab, currentRelease(lab));
    const plan = planOf(
      expectCode(
        cli(lab, ['--json', 'deploy', '--bundle', bundle, '--plan-only']),
        0,
      ),
    );
    expect(
      plan.resources.filter((resource) => resource.action !== 'unchanged'),
    ).toEqual([]);
    expect(plan.changed).toBe(false);
  });

  test('a second deploy --bundle changes nothing on the node', () => {
    deployed(lab);
    const bundle = prepared(lab, currentRelease(lab));
    const before = fingerprint();
    const receipt = receiptOf(lab);
    const run = expectCode(
      cli(lab, ['deploy', '--bundle', bundle, '--yes']),
      0,
    );
    record(lab, 'fresh-noop', { noopDeployMs: run.ms });
    expect(fingerprint()).toEqual(before);
    expect(receiptOf(lab)?.bundleSha256).toBe(receipt?.bundleSha256);
    expect(receiptOf(lab)?.phase).toBe('ready');
  });
});
