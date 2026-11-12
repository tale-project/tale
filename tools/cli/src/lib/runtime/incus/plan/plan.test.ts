import { describe, expect, test } from 'bun:test';

import {
  convergedReadback,
  desiredOf,
  emptyReadback,
  goldenTarget,
  renderedFiles,
  SENTINEL_SECRET,
  testKey,
  withNewImage,
} from '../apply/apply-fixture';
import type { ObservedInstance, Readback } from '../apply/readback';
import {
  colourDocument,
  compileInput,
  statefulDocument,
} from '../compile/compile-fixture';
import {
  compileStackTarget,
  requireStackTarget,
} from '../compile/stack-target';
import {
  DEFERRED_INFRASTRUCTURE_HINT,
  DEFERRED_STOP_GATED_HINT,
  MISSING_DATA_HINT,
  plan,
  tierOrder,
  type DesiredStack,
  type PlanScope,
  type RenderedFile,
} from './plan';
import {
  INCUS_PLAN_ACTIONS,
  INCUS_PLAN_EFFECTS,
  incusPlanSchema,
  isEmptyPlan,
  type IncusPlan,
  type IncusPlanResource,
} from './plan-model';

const FULL: PlanScope = { phase: 'full', stop: false };
const STOP: PlanScope = { phase: 'full', stop: true };

function managed(): DesiredStack {
  return desiredOf(goldenTarget('managed-compose'));
}

function resource(made: IncusPlan, id: string): IncusPlanResource {
  const found = made.resources.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`No ${id} in the plan.`);
  return found;
}

function instanceOf(readback: Readback, name: string): ObservedInstance {
  const found = readback.instances.find((instance) => instance.name === name);
  if (found === undefined) throw new Error(`No ${name}.`);
  return found;
}

/** The readback with one instance changed. */
function changed(
  readback: Readback,
  name: string,
  change: (instance: ObservedInstance) => ObservedInstance,
): Readback {
  return {
    ...readback,
    instances: readback.instances.map((instance) =>
      instance.name === name ? change(instance) : instance,
    ),
  };
}

describe('a first deploy', () => {
  const desired = managed();
  const made = plan(desired, emptyReadback(desired), FULL);

  test('creates every resource, in the order the applier converges them', () => {
    expect(made.resources.every((item) => item.action === 'create')).toBe(true);
    const kinds = made.resources.map((item) => item.id.split('/')[0]);
    const firstOf = (kind: string) => kinds.indexOf(kind);
    const lastOf = (kind: string) => kinds.lastIndexOf(kind);
    expect(lastOf('image')).toBeLessThan(firstOf('volume'));
    expect(lastOf('volume')).toBeLessThan(firstOf('file'));
    expect(lastOf('file')).toBeLessThan(firstOf('instance'));
    const instances = made.resources
      .filter((item) => item.id.startsWith('instance/'))
      .map((item) => item.id.slice('instance/'.length));
    // The resolvers first, the data tier before its users, the switch last.
    expect(instances.slice(0, 2).sort()).toEqual(['names', 'names-sessions']);
    expect(instances.indexOf('db')).toBeLessThan(
      instances.indexOf('platform-1'),
    );
    // platform depends on the proxy, whose priority is lower.
    expect(instances.indexOf('proxy')).toBeLessThan(
      instances.indexOf('platform-1'),
    );
    expect(instances.at(-1)).toBe('switch');
  });

  test('names the effects of the resolvers and the switch, and no other', () => {
    expect(resource(made, 'instance/switch').effects).toEqual(['switch']);
    expect(resource(made, 'instance/names').effects).toEqual(['names']);
    expect(
      resource(made, 'file/names-config/stack/hosts/hosts').effects,
    ).toEqual(['names']);
    expect(resource(made, 'volume/db-data').effects).toEqual([]);
    expect(resource(made, 'volume/backups').action).toBe('create');
    expect(made.resources.some((item) => item.effects.includes('data'))).toBe(
      false,
    );
    // The switch's upstream lists are part of it, not resources of their own.
    expect(
      made.resources.some((item) => item.id.startsWith('file/switch-config/')),
    ).toBe(false);
  });

  test('is pure, schema-valid, and carries no value of the environment', () => {
    expect(plan(desired, emptyReadback(desired), FULL)).toEqual(made);
    expect(incusPlanSchema.parse(made)).toEqual(made);
    expect(JSON.stringify(made)).not.toContain(SENTINEL_SECRET);
  });

  test('a stack compiled for another project is refused', () => {
    expect(() =>
      plan(
        {
          ...desired,
          destination: { ...desired.destination, project: 'other' },
        },
        emptyReadback(desired),
        FULL,
      ),
    ).toThrow('compiled for project tale-stack');
  });
});

describe('a converged stack', () => {
  const desired = managed();
  const readback = convergedReadback(desired);

  test('plans nothing', () => {
    const made = plan(desired, readback, FULL);
    expect(made.resources.map((item) => item.action)).toEqual(
      made.resources.map(() => 'unchanged'),
    );
    expect(isEmptyPlan(made)).toBe(true);
    expect(resource(made, 'instance/db').revision).toBe('"etag-db"');
  });

  test("a pool's volume defaults are not drift; a key the target sets is", () => {
    // Incus copies the pool's volume.* defaults into each new volume.
    const pooled: Readback = {
      ...readback,
      volumes: readback.volumes.map((volume) => ({
        ...volume,
        config: {
          size: '1GiB',
          'snapshots.expiry': '7d',
          'zfs.remove_snapshots': 'true',
          ...volume.config,
        },
      })),
    };
    expect(isEmptyPlan(plan(desired, pooled, FULL))).toBe(true);

    const drifted = structuredClone(pooled);
    for (const volume of drifted.volumes)
      if (volume.name === 'db-data')
        volume.config = { ...volume.config, 'security.shifted': 'false' };
    expect(
      resource(plan(desired, drifted, FULL), 'volume/db-data'),
    ).toMatchObject({ action: 'update', effects: [] });
  });

  test('the OCI keys Incus fills from the image are not drift', () => {
    // Incus 7.6 copies the image's cwd, uid and gid into oci.* at create.
    const filled: Readback = {
      ...readback,
      instances: readback.instances.map((instance) => ({
        ...instance,
        config: {
          ...instance.config,
          'image.oci.cwd': '/',
          'image.oci.uid': '0',
          'image.oci.gid': '0',
          'oci.cwd': '/',
          'oci.uid': '0',
          'oci.gid': '0',
        },
      })),
    };
    expect(isEmptyPlan(plan(desired, filled, FULL))).toBe(true);
    // A value the image does not hold was set by hand: it is drift.
    expect(
      resource(
        plan(
          desired,
          changed(filled, 'db', (db) => ({
            ...db,
            config: { ...db.config, 'oci.uid': '70' },
          })),
          STOP,
        ),
        'instance/db',
      ).action,
    ).toBe('replace');
  });

  test('Incus 7.6 fills cwd, uid and gid with no image.oci.* beside them: not drift (TI-13, measured)', () => {
    // As an instance of an OCI image reads back on Incus 7.6: oci.cwd,
    // oci.uid and oci.gid set, and no image.oci.cwd/uid/gid.
    const filled: Readback = {
      ...readback,
      instances: readback.instances.map((instance) => ({
        ...instance,
        config: {
          ...instance.config,
          'image.type': 'oci',
          'image.oci.title': 'tale',
          'oci.cwd': '/app',
          'oci.uid': '0',
          'oci.gid': '0',
        },
      })),
    };
    expect(isEmptyPlan(plan(desired, filled, FULL))).toBe(true);
  });

  test('a stopped instance is started (update)', () => {
    const made = plan(
      desired,
      changed(readback, 'db', (db) => ({
        ...db,
        running: false,
        status: 'Stopped',
      })),
      FULL,
    );
    expect(resource(made, 'instance/db')).toMatchObject({
      action: 'update',
      effects: [],
    });
  });

  test('a live key changes in place (update), anything else replaces', () => {
    const target = structuredClone(desired.target);
    const gateway = target.instances.find(
      (spec) => spec.name === 'sandbox-llm-gateway',
    );
    if (!gateway) throw new Error('no gateway');
    gateway.config['limits.memory'] = '3GiB';
    let made = plan(desiredOf(target), readback, FULL);
    expect(resource(made, 'instance/sandbox-llm-gateway').action).toBe(
      'update',
    );

    gateway.config['environment.EXTRA'] = 'x';
    made = plan(desiredOf(target), readback, FULL);
    expect(resource(made, 'instance/sandbox-llm-gateway')).toMatchObject({
      action: 'replace',
      effects: [],
    });
  });

  test('replacing the spawner drains it; replacing a backend drains it', () => {
    let target = withNewImage(desired.target, 'tale-sandbox', '1'.repeat(64));
    target = withNewImage(target, 'tale-platform', '2'.repeat(64));
    const made = plan(desiredOf(target), readback, FULL);
    expect(resource(made, 'instance/sandbox').effects).toEqual([
      'drain-sandbox',
    ]);
    expect(resource(made, 'instance/backend-api-1').effects).toEqual([
      'drain-backend',
    ]);
    expect(resource(made, 'instance/backend-worker-1').effects).toEqual([
      'drain-backend',
    ]);
    expect(resource(made, 'instance/platform-1')).toMatchObject({
      action: 'replace',
      effects: [],
    });
    expect(
      resource(
        made,
        `image/${target.images.find((i) => i.reference.includes('tale-platform@'))?.alias}`,
      ).action,
    ).toBe('create');
  });

  test('a running stop-gated service is deferred without --stop and stops with it', () => {
    const target = withNewImage(desired.target, 'tale-db', '3'.repeat(64));
    const deferred = plan(desiredOf(target), readback, FULL);
    expect(resource(deferred, 'instance/db')).toMatchObject({
      action: 'deferred',
      effects: [],
      hint: DEFERRED_STOP_GATED_HINT,
    });
    const stopped = plan(desiredOf(target), readback, STOP);
    expect(resource(stopped, 'instance/db')).toMatchObject({
      action: 'replace',
      effects: ['downtime'],
    });
    // Already stopped: a replace costs nothing.
    const idle = plan(
      desiredOf(target),
      changed(readback, 'db', (db) => ({
        ...db,
        running: false,
        status: 'Stopped',
      })),
      FULL,
    );
    expect(resource(idle, 'instance/db')).toMatchObject({
      action: 'replace',
      effects: [],
    });
  });

  test('the switch keeps its image until --stop, unless it cannot read the format (R-02)', () => {
    const target = withNewImage(desired.target, 'tale-proxy', '4'.repeat(64));
    const deferred = plan(desiredOf(target), readback, FULL);
    expect(resource(deferred, 'instance/switch')).toMatchObject({
      action: 'deferred',
      hint: DEFERRED_INFRASTRUCTURE_HINT,
    });
    // The proxy (edge) is stop-gated as on Docker.
    expect(resource(deferred, 'instance/proxy').action).toBe('deferred');
    expect(
      resource(plan(desiredOf(target), readback, STOP), 'instance/switch'),
    ).toMatchObject({ action: 'replace', effects: ['downtime', 'switch'] });

    const old = changed(readback, 'switch', (instance) => {
      const config = { ...instance.config };
      delete config['user.tale.infra-formats'];
      return { ...instance, config };
    });
    const forced = plan(desiredOf(target), old, FULL);
    expect(resource(forced, 'instance/switch')).toMatchObject({
      action: 'replace',
      effects: ['downtime', 'switch'],
    });
    expect(resource(forced, 'instance/switch').hint).toContain(
      'does not read switch-upstreams/1',
    );
  });

  test('a new upstream list replaces the switch, behind --stop', () => {
    const files = renderedFiles(desired.target);
    for (const file of files)
      if (file.instance === 'switch')
        file.content = new TextEncoder().encode('to 10.0.0.9:3000\n');
    const made = plan(
      desiredOf(desired.target, testKey(), files),
      readback,
      FULL,
    );
    expect(resource(made, 'instance/switch')).toMatchObject({
      action: 'replace',
      effects: ['downtime', 'switch'],
    });
  });

  test('new resolver records are written in place, with the names effect', () => {
    const made = plan(
      desiredOf(desired.target, testKey(), renderedFiles(desired.target, 'v2')),
      readback,
      FULL,
    );
    expect(resource(made, 'file/names-config/stack/hosts/hosts')).toMatchObject(
      {
        action: 'update',
        effects: ['names'],
      },
    );
    expect(
      renderedFiles(desired.target)
        .filter((file) => file.volume === 'names-config')
        .map((file) => file.write),
    ).toEqual(['overwrite', 'overwrite', 'overwrite', 'overwrite']);
  });

  test('a file written by generation retires the superseded ones', () => {
    const generational = (files: RenderedFile[]) =>
      files.map((file) =>
        file.path === 'sessions/hosts/hosts'
          ? { ...file, write: 'generation' as const }
          : file,
      );
    const current = desiredOf(
      desired.target,
      testKey(),
      generational(renderedFiles(desired.target)),
    );
    const observed: Readback = {
      ...readback,
      files: readback.files.map((file) =>
        file.path === 'sessions/hosts/hosts'
          ? { ...file, generation: 1 }
          : file,
      ),
    };
    expect(
      resource(
        plan(current, observed, FULL),
        'file/names-config/sessions/hosts/hosts',
      ).action,
    ).toBe('unchanged');
    // A superseded generation left by a crash is retired.
    const stale: Readback = {
      ...observed,
      files: [
        ...observed.files,
        {
          ...(observed.files.find(
            (file) => file.path === 'sessions/hosts/hosts',
          ) ?? observed.files[0]!),
          generation: 0,
          sha256: 'f'.repeat(64),
        },
      ],
    };
    expect(
      resource(
        plan(current, stale, FULL),
        'file/names-config/sessions/hosts/hosts',
      ).action,
    ).toBe('update');
  });

  test('an instance the target dropped is deleted last, drained when it is a backend', () => {
    const target = structuredClone(desired.target);
    target.instances = target.instances.filter(
      (spec) =>
        spec.name !== 'backend-worker-1' && spec.name !== 'bgutil-provider',
    );
    const made = plan(desiredOf(target), readback, FULL);
    expect(made.resources.slice(-2)).toMatchObject([
      {
        id: 'instance/backend-worker-1',
        action: 'delete',
        effects: ['drain-backend'],
      },
      { id: 'instance/bgutil-provider', action: 'delete', effects: [] },
    ]);
  });

  test('every action and every effect is reachable', () => {
    const seen = { actions: new Set<string>(), effects: new Set<string>() };
    const note = (made: IncusPlan) => {
      for (const item of made.resources) {
        seen.actions.add(item.action);
        for (const effect of item.effects) seen.effects.add(effect);
      }
    };
    note(plan(desired, emptyReadback(desired), FULL));
    note(plan(desired, readback, FULL));
    let target = withNewImage(desired.target, 'tale-db', '5'.repeat(64));
    target = withNewImage(target, 'tale-sandbox', '6'.repeat(64));
    target = withNewImage(target, 'tale-platform', '7'.repeat(64));
    note(plan(desiredOf(target), readback, FULL));
    note(plan(desiredOf(target), readback, STOP));
    note(
      plan(
        desired,
        {
          ...readback,
          volumes: readback.volumes.filter((v) => v.name !== 'db-data'),
        },
        FULL,
      ),
    );
    const dropped = structuredClone(desired.target);
    dropped.instances = dropped.instances.filter((spec) => spec.name !== 'db');
    note(plan(desiredOf(dropped), readback, FULL));
    const gateway = structuredClone(desired.target);
    for (const spec of gateway.instances)
      if (spec.name === 'sandbox-llm-gateway')
        spec.config['limits.memory'] = '1GiB';
    note(plan(desiredOf(gateway), readback, FULL));
    expect([...seen.actions].sort()).toEqual([...INCUS_PLAN_ACTIONS].sort());
    expect([...seen.effects].sort()).toEqual([...INCUS_PLAN_EFFECTS].sort());
  });
});

describe('custody (a readback is custody)', () => {
  const desired = managed();
  const readback = convergedReadback(desired);

  test("another stack's instance or volume is refused, never adopted", () => {
    expect(() =>
      plan(
        desired,
        changed(readback, 'db', (db) => ({
          ...db,
          custody: { verdict: 'foreign', stack: 'other' },
        })),
        FULL,
      ),
    ).toThrow('Instance db belongs to the stack other');
    expect(() =>
      plan(
        desired,
        changed(readback, 'proxy', (proxy) => ({
          ...proxy,
          custody: { verdict: 'unlabelled' },
        })),
        FULL,
      ),
    ).toThrow('Instance proxy exists without a stack label');
    expect(() =>
      plan(
        desired,
        {
          ...readback,
          volumes: readback.volumes.map((volume) =>
            volume.name === 'db-data'
              ? { ...volume, custody: { verdict: 'foreign', stack: 'x' } }
              : volume,
          ),
        },
        FULL,
      ),
    ).toThrow('Volume db-data belongs to the stack x');
  });

  test("another stack's instances are never orphans", () => {
    const foreign: ObservedInstance = {
      ...instanceOf(readback, 'db'),
      name: 'someone-else',
      custody: { verdict: 'foreign', stack: 'other' },
    };
    const made = plan(
      desired,
      { ...readback, instances: [...readback.instances, foreign] },
      FULL,
    );
    expect(made.resources.some((item) => item.action === 'delete')).toBe(false);
  });
});

describe('a missing data volume (R3-22)', () => {
  const desired = managed();
  const converged = convergedReadback(desired);
  const withoutDb = (readback: Readback): Readback => ({
    ...readback,
    volumes: readback.volumes.filter((volume) => volume.name !== 'db-data'),
  });

  test('a true first deploy creates it', () => {
    const made = plan(desired, emptyReadback(desired), FULL);
    expect(resource(made, 'volume/db-data')).toMatchObject({
      action: 'create',
      effects: [],
    });
  });

  test('every sign that the stack ran before makes it a data effect', () => {
    const signs: Readback[] = [
      // The deploy record.
      { ...emptyReadback(desired), record: converged.record },
      // An instance of the stack.
      {
        ...emptyReadback(desired),
        instances: [instanceOf(converged, 'proxy')],
      },
      // A snapshot manifest.
      { ...emptyReadback(desired), manifests: true },
      // A restore's holder.
      {
        ...emptyReadback(desired),
        volumes: [
          {
            name: 'db-data.pre-restore-20261113T090000Z',
            config: {},
            usedBy: [],
            custody: { verdict: 'stack' },
          },
        ],
      },
    ];
    for (const readback of signs) {
      const made = plan(desired, withoutDb(readback), FULL);
      expect(resource(made, 'volume/db-data')).toMatchObject({
        action: 'create',
        effects: ['data'],
        hint: MISSING_DATA_HINT,
      });
    }
    // A runtime volume is rendered again; it is never a data effect.
    const runtime = plan(
      desired,
      {
        ...converged,
        volumes: converged.volumes.filter((v) => v.name !== 'names-config'),
      },
      FULL,
    );
    expect(resource(runtime, 'volume/names-config').effects).toEqual([]);
  });

  test('the first deploy after a recorded reset creates it, and only that one', () => {
    const reset: Readback = {
      ...emptyReadback(desired),
      record: {
        schemaVersion: 1,
        stack: desired.target.stack,
        deployedAt: '2026-11-12T10:00:00.000Z',
        resetAt: '2026-11-13T08:00:00.000Z',
      },
      manifests: true,
    };
    expect(
      resource(plan(desired, reset, FULL), 'volume/db-data').effects,
    ).toEqual([]);
    const redeployed: Readback = {
      ...reset,
      record: { ...reset.record!, deployedAt: '2026-11-13T09:00:00.000Z' },
    };
    expect(
      resource(plan(desired, redeployed, FULL), 'volume/db-data').effects,
    ).toEqual(['data']);
  });
});

describe('phases and the switch (R3-02)', () => {
  const workspace = (replicas: number) =>
    requireStackTarget(
      compileStackTarget(
        compileInput(
          'workspace',
          [
            { compose: statefulDocument() },
            { compose: colourDocument('blue'), colour: 'blue' },
            { compose: colourDocument('green'), colour: 'green' },
          ],
          {
            replicas: {
              platform: replicas,
              'backend-api': replicas,
              'backend-worker': 1,
            },
          },
        ),
      ),
    );

  test('a scale change rewrites no switch file and does not touch the switch', () => {
    const one = desiredOf(workspace(1));
    const three = desiredOf(workspace(3));
    const files = (desired: DesiredStack) =>
      desired.files
        .filter((file) => file.instance === 'switch')
        .map((file) => new TextDecoder().decode(file.content));
    expect(files(three)).toEqual(files(one));
    const made = plan(three, convergedReadback(one), FULL);
    expect(resource(made, 'instance/switch').action).toBe('unchanged');
    expect(resource(made, 'instance/platform-blue-3').action).toBe('create');
  });

  test('a colour phase plans that colour alone, and deletes only its orphans', () => {
    const desired = desiredOf(workspace(2));
    const readback = convergedReadback(desired);
    const blueOnly = structuredClone(desired.target);
    blueOnly.instances = blueOnly.instances.filter(
      (spec) => spec.colour !== 'blue' || spec.name !== 'platform-blue-2',
    );
    const made = plan(desiredOf(blueOnly), readback, {
      phase: 'colour-blue',
      stop: false,
    });
    const instances = made.resources.filter((item) =>
      item.id.startsWith('instance/'),
    );
    expect(instances.every((item) => item.id.includes('-blue-'))).toBe(true);
    expect(resource(made, 'instance/platform-blue-2').action).toBe('delete');
    expect(made.resources.some((item) => item.id === 'instance/db')).toBe(
      false,
    );
  });

  test('the ingress is its own resource, after the instances (design 7.1)', () => {
    const desired = desiredOf(goldenTarget('stateful'));
    const first = plan(desired, emptyReadback(desired), FULL);
    const ingress = resource(first, 'ingress/proxy');
    expect(ingress.action).toBe('create');
    expect(first.resources.indexOf(ingress)).toBeGreaterThan(
      first.resources.indexOf(resource(first, 'instance/switch')),
    );
    const converged = convergedReadback(desired);
    expect(
      resource(plan(desired, converged, FULL), 'ingress/proxy').action,
    ).toBe('unchanged');
    const bare = changed(converged, 'proxy', (proxy) => ({
      ...proxy,
      devices: Object.fromEntries(
        Object.entries(proxy.devices).filter(
          ([name]) => !name.startsWith('ingress-'),
        ),
      ),
    }));
    expect(resource(plan(desired, bare, FULL), 'ingress/proxy').action).toBe(
      'create',
    );
  });

  test('the tier order puts a dependant after what it depends on', () => {
    const order = tierOrder(goldenTarget('managed-compose').instances).map(
      (spec) => spec.name,
    );
    expect(order.indexOf('sandbox-egress')).toBeLessThan(
      order.indexOf('sandbox'),
    );
    expect(order.indexOf('object-store')).toBeLessThan(
      order.indexOf('backend-api-1'),
    );
  });
});
