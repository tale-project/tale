// infra-skew: the CLI of release N+1 against a switch and resolvers still on
// release N's image (design D-17, R-02, R3-02). A deploy of N+1 moves the
// colours to N+1 and leaves the infrastructure tier as it runs: the plan
// defers it, the switch, `names` and `names-sessions` keep their instance and
// their image, and the switch's upstream files never change. Only a deploy
// with --stop replaces the tier with N+1's image; the files it writes then
// are the same lists. (That a running image which does not read the CLI's
// format is replaced only under --stop is held by the planner's unit tests:
// a released proxy image always names its format, R3-23.)

import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { expectCode, jsonOf, record } from '../harness';
import {
  execIn,
  instanceOf,
  loadWorkspace,
  replicasOf,
  colourOf,
  serving,
  tale,
  workspaceDeployed,
  workspaceInstances,
} from '../workspace';

setDefaultTimeout(60 * 60_000);
const w = loadWorkspace();
const [N, NEXT] = w.releases;
const INFRASTRUCTURE = ['switch', 'names', 'names-sessions'] as const;

/** Each infrastructure instance: its identity, its image and its version. */
function tier() {
  return Object.fromEntries(
    INFRASTRUCTURE.map((service) => {
      const instance = instanceOf(w, service);
      return [
        service,
        {
          uuid: instance.uuid,
          image: instance.config['user.tale.image'] ?? '',
          base: instance.config['volatile.base_image'] ?? '',
          version: instance.version,
          status: instance.status,
        },
      ];
    }),
  );
}

/** The switch's upstream files, as it reads them. */
function upstreams(): string {
  const out = execIn(
    w,
    instanceOf(w, 'switch').name,
    'for file in /switch/*.upstreams; do echo "== $file"; cat "$file"; done',
  );
  if (out.code !== 0)
    throw new Error(`reading the switch's files: ${out.stderr}`);
  return out.stdout;
}

/** The infrastructure resources of a --plan-only --json plan. */
function plannedInfrastructure(release: 0 | 1, stop: boolean) {
  const run = expectCode(
    tale(w, ['--json', 'deploy', '--plan-only', ...(stop ? ['--stop'] : [])], {
      release,
    }),
    0,
  );
  const plan = jsonOf<{
    data: {
      scopes: {
        scope: string;
        plan: { resources: { id: string; action: string }[] };
      }[];
    };
  }>(run).data;
  return (
    plan.scopes.find((scope) => scope.scope === 'infrastructure')?.plan
      .resources ?? []
  ).filter((resource) =>
    (INFRASTRUCTURE as readonly string[]).includes(
      resource.id.replace(/^instance\//, ''),
    ),
  );
}

describe('infra-skew', () => {
  test(`release ${NEXT}'s CLI leaves release ${N}'s switch and resolvers running; --stop replaces them`, async () => {
    await workspaceDeployed(w);
    // The workspace starts from release N everywhere.
    if (instanceOf(w, 'switch').version !== N)
      expectCode(tale(w, ['deploy', '--stop', '--yes', '--skip-backup']), 0);
    await serving(w);
    const before = tier();
    const filesBefore = upstreams();
    expect(Object.values(before).every((entry) => entry.version === N)).toBe(
      true,
    );

    const deferred = plannedInfrastructure(1, false);
    const skew = expectCode(
      tale(w, ['deploy', '--yes', '--skip-backup'], { release: 1 }),
      0,
    );
    await serving(w);
    const afterSkew = tier();
    const filesAfterSkew = upstreams();
    const colour = colourOf(w) ?? '';
    const colourVersions = [
      ...replicasOf(w, 'platform', colour),
      ...replicasOf(w, 'backend-api', colour),
    ].map((instance) => instance.version);

    const replacing = plannedInfrastructure(1, true);
    expectCode(
      tale(w, ['deploy', '--stop', '--yes', '--skip-backup'], { release: 1 }),
      0,
    );
    await serving(w);
    const afterStop = tier();
    const filesAfterStop = upstreams();

    record(w.lab, 'infra-skew', {
      before,
      deferredPlan: deferred,
      afterSkew,
      colourVersions,
      replacingPlan: replacing,
      afterStop,
      filesUnchanged:
        filesBefore === filesAfterSkew && filesBefore === filesAfterStop,
      instances: workspaceInstances(w).map(
        (instance) => `${instance.name} ${instance.version}`,
      ),
    });

    // N+1 without --stop: deferred, untouched, the colours on N+1.
    expect(deferred.map((resource) => resource.action).sort()).toEqual(
      INFRASTRUCTURE.map(() => 'deferred'),
    );
    expect(skew.stdout + skew.stderr).toContain('--stop');
    expect(afterSkew).toEqual(before);
    expect(filesAfterSkew).toBe(filesBefore);
    expect(colourVersions.length).toBeGreaterThan(0);
    expect(colourVersions.every((version) => version === NEXT)).toBe(true);
    // --stop: replaced with N+1's image; the same lists.
    expect(replacing.map((resource) => resource.action).sort()).toEqual(
      INFRASTRUCTURE.map(() => 'replace'),
    );
    for (const service of INFRASTRUCTURE) {
      expect(afterStop[service]?.uuid).not.toBe(before[service]?.uuid);
      expect(afterStop[service]?.version).toBe(NEXT);
      expect(afterStop[service]?.status).toBe('Running');
    }
    expect(filesAfterStop).toBe(filesBefore);
  });
});
