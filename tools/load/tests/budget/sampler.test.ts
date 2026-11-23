import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import type {
  ContainerSource,
  DeploymentContainer,
  EngineFacts,
} from '../../src/budget/docker.ts';
import { BudgetSampler } from '../../src/budget/sampler.ts';
import { type FakeTree, fakeTree } from './fake-cgroup.ts';

const ENGINE: EngineFacts = {
  cgroupDriver: 'systemd',
  cgroupVersion: 2,
  serverVersion: '28.1.1',
  architecture: 'x86_64',
  rootless: false,
};

const idOf = (n: number): string => n.toString(16).padStart(64, '0');
const scope = (n: number): string => `/system.slice/docker-${idOf(n)}.scope`;

/** A deployment the test changes between listings. */
class FakeSource implements ContainerSource {
  containers: DeploymentContainer[] = [];
  failNext = false;

  add(
    n: number,
    service: string,
    project = 'tale-x',
    colour: DeploymentContainer['colour'] = null,
  ): void {
    this.containers.push({
      id: idOf(n),
      name: `${project}-${service}-${n}`,
      project,
      service,
      colour,
      pid: 1000 + n,
    });
  }

  drop(n: number): void {
    this.containers = this.containers.filter((c) => c.id !== idOf(n));
  }

  async list(): Promise<DeploymentContainer[]> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('docker ps failed: Cannot connect to the Docker daemon');
    }
    return [...this.containers];
  }

  async engine(): Promise<EngineFacts> {
    return ENGINE;
  }
}

const MIB = 1_048_576;

describe('BudgetSampler', () => {
  let tree: FakeTree;
  let source: FakeSource;
  let clock: number;
  let warnings: string[];

  const sampler = (): BudgetSampler =>
    new BudgetSampler({
      source,
      locator: tree.locator,
      intervalMs: 250,
      now: () => clock,
      warn: (line) => warnings.push(line),
    });

  /** A running container of the deployment holding `anon` MiB. */
  const container = (
    n: number,
    service: string,
    anonMib: number,
    options: { project?: string; colour?: 'blue' | 'green' } = {},
  ): void => {
    source.add(n, service, options.project, options.colour ?? null);
    tree.process(1000 + n, scope(n));
    tree.stat(scope(n), { anon: anonMib * MIB, file: 50 * MIB });
  };

  beforeEach(() => {
    tree = fakeTree();
    source = new FakeSource();
    clock = 10_000;
    warnings = [];
  });
  afterEach(() => tree.close());

  test('the deployment’s reading is the sum of one instant; each container keeps its own peak', async () => {
    container(1, 'platform', 150, { project: 'tale-x-blue', colour: 'blue' });
    container(2, 'db', 90);
    container(3, 'proxy', 20);
    const s = sampler();
    await s.open();
    s.tick();
    clock += 250;
    // The platform rises while the database falls: the sum of one instant,
    // not the sum of each container's own peak, is the deployment's reading.
    tree.stat(scope(1), { anon: 200 * MIB, file: 10 * MIB });
    tree.stat(scope(2), { anon: 60 * MIB, file: 80 * MIB });
    s.tick();
    clock += 250;
    tree.stat(scope(1), { anon: 120 * MIB, file: 10 * MIB });
    s.tick();
    const figures = s.figures();

    expect(figures.instants).toBe(3);
    expect(figures.peak?.counted).toBe(280 * MIB);
    expect(figures.peak?.atMs).toBe(250);
    expect(figures.peak?.file).toBe(140 * MIB);
    expect(
      figures.peak?.parts.map((p) => [p.service, p.counted / MIB]),
    ).toEqual([
      ['platform', 200],
      ['db', 60],
      ['proxy', 20],
    ]);
    const db = figures.containers.find((c) => c.service === 'db');
    expect(db?.peakCounted).toBe(90 * MIB);
    expect(db?.peakCountedAtMs).toBe(0);
    expect(db?.peakFile).toBe(80 * MIB);
    expect(db?.peakFileAtMs).toBe(250);
    expect(db?.fileAtPeak).toBe(50 * MIB);
    expect(db?.share).toBe('postgres');
    expect(db?.via).toBe('proc');
    expect(figures.shares.find((x) => x.key === 'app-tier')).toEqual({
      key: 'app-tier',
      peakCounted: 200 * MIB,
      peakAtMs: 250,
    });
    expect(figures.series.map((p) => p.counted / MIB)).toEqual([260, 280, 200]);
    expect(figures.engine).toEqual(ENGINE);
  });

  test('a container that starts is read from the next listing; one that stops is read no more', async () => {
    container(1, 'db', 100);
    const s = sampler();
    await s.open();
    s.tick();
    container(2, 'sandbox', 30);
    clock += 250;
    s.tick();
    expect(s.latest()?.counted).toBe(100 * MIB);
    await s.discover();
    clock += 250;
    s.tick();
    expect(s.latest()?.counted).toBe(130 * MIB);

    // Its cgroup vanishes before the next listing: gone from this instant.
    tree.remove(scope(2));
    clock += 250;
    s.tick();
    expect(s.latest()?.counted).toBe(100 * MIB);
    const sandbox = s.figures().containers.find((c) => c.service === 'sandbox');
    expect(sandbox?.goneMs).toBe(750);
    expect(sandbox?.samples).toBe(1);

    // Unlisted: gone at that listing, though its cgroup is still there.
    source.drop(1);
    clock += 250;
    await s.discover();
    s.tick();
    expect(s.latest()?.counted).toBe(0);
    expect(s.figures().containers.find((c) => c.service === 'db')?.goneMs).toBe(
      1000,
    );
    expect(s.figures().peak?.counted).toBe(130 * MIB);
  });

  test('a blue/green overlap leaves the smaller colour out of the ceiling and reports it', async () => {
    container(1, 'platform', 180, { project: 'tale-x-blue', colour: 'blue' });
    container(2, 'db', 100);
    const s = sampler();
    await s.open();
    s.tick();
    container(3, 'platform', 70, { project: 'tale-x-green', colour: 'green' });
    await s.discover();
    clock += 250;
    s.tick();
    const latest = s.latest();
    expect(latest?.total).toBe(350 * MIB);
    expect(latest?.overlap).toBe(70 * MIB);
    expect(latest?.counted).toBe(280 * MIB);
    // The new colour outgrows the old one: the old one is now the overlap.
    tree.stat(scope(3), { anon: 200 * MIB });
    clock += 250;
    s.tick();
    expect(s.latest()?.overlap).toBe(180 * MIB);
    expect(s.latest()?.counted).toBe(300 * MIB);
    const figures = s.figures();
    expect(figures.overlap).toEqual({
      instants: 2,
      peak: 180 * MIB,
      peakAtMs: 500,
    });
    expect(figures.shares.find((x) => x.key === 'app-tier')?.peakCounted).toBe(
      200 * MIB,
    );
    expect(figures.peak?.counted).toBe(300 * MIB);
  });

  test('a container outside every share still counts toward the deployment', async () => {
    container(1, 'bgutil-provider', 60);
    container(2, 'db', 100);
    const s = sampler();
    await s.open();
    s.tick();
    const figures = s.figures();
    expect(figures.peak?.counted).toBe(160 * MIB);
    expect(figures.unshared).toEqual({ peakCounted: 60 * MIB, peakAtMs: 0 });
    expect(
      figures.containers.find((c) => c.service === 'bgutil-provider')?.share,
    ).toBeNull();
  });

  test('the gaps between instants are measured, and late ones counted', async () => {
    container(1, 'db', 10);
    const s = sampler();
    await s.open();
    s.tick();
    clock += 250;
    s.tick();
    clock += 1_400;
    s.tick();
    clock += 260;
    s.tick();
    const figures = s.figures();
    expect(figures.maxGapMs).toBe(1_400);
    expect(figures.lateInstants).toBe(1);
  });

  test('a container whose cgroup cannot be found is named, never read', async () => {
    source.add(1, 'object-store');
    container(2, 'db', 10);
    const s = sampler();
    await s.open();
    s.tick();
    const store = s
      .figures()
      .containers.find((c) => c.service === 'object-store');
    expect(store?.samples).toBe(0);
    expect(store?.unresolved).toContain('no cgroup with a memory.stat');
    expect(warnings.some((line) => line.includes('object-store'))).toBe(true);
  });

  test('containers in one cgroup that names none of them are never read, not read once each', async () => {
    // The review's probe: three containers whose processes sit in one
    // cgroup (a rootless engine's service, or pids another process took).
    const shared =
      '/user.slice/user-1000.slice/user@1000.service/app.slice/docker.service';
    tree.stat(shared, { anon: 300 * MIB });
    for (const [n, service] of [
      [1, 'platform'],
      [2, 'db'],
      [3, 'proxy'],
    ] as const) {
      source.add(n, service);
      tree.process(1000 + n, shared);
    }
    const s = sampler();
    await s.open();
    s.tick();
    const figures = s.figures();
    expect(figures.peak).toBeNull();
    expect(figures.containers.map((c) => [c.samples, c.cgroup])).toEqual([
      [0, null],
      [0, null],
      [0, null],
    ]);
    expect(
      figures.containers.every((c) =>
        (c.unresolved ?? '').includes('no cgroup with a memory.stat'),
      ),
    ).toBe(true);
  });

  test('a second container whose cgroup is one read already is not read, and is named', async () => {
    container(1, 'db', 100);
    container(2, 'proxy', 30);
    const s = new BudgetSampler({
      source,
      locator: tree.locator,
      now: () => clock,
      warn: (line) => warnings.push(line),
      // Both resolve to the database's own cgroup.
      resolve: (locator) => ({
        dir: join(locator.root, scope(1)),
        via: 'proc',
      }),
    });
    await s.open();
    s.tick();
    const figures = s.figures();
    expect(figures.peak?.counted).toBe(100 * MIB);
    const proxy = figures.containers.find((c) => c.service === 'proxy');
    expect(proxy?.samples).toBe(0);
    expect(proxy?.unresolved).toContain('read for both');
    expect(figures.cgroupConflicts).toHaveLength(1);
    expect(figures.cgroupConflicts[0]).toStartWith('tale-x-proxy-2:');
  });

  test('the longest time without a listing counts failed listings and the run’s end', async () => {
    container(1, 'db', 10);
    const s = sampler();
    await s.open();
    clock += 1_000;
    await s.discover();
    clock += 3_000;
    source.failNext = true;
    await s.discover();
    clock += 3_000;
    await s.discover();
    expect(s.figures().maxListingGapMs).toBe(6_000);
    clock += 10_000;
    const figures = s.figures();
    expect(figures.listings).toBe(3);
    expect(figures.listingErrors).toBe(1);
    expect(figures.maxListingGapMs).toBe(10_000);
  });

  test('a listing that fails keeps the containers already known', async () => {
    container(1, 'db', 10);
    const s = sampler();
    await s.open();
    source.failNext = true;
    await s.discover();
    s.tick();
    const figures = s.figures();
    expect(figures.listings).toBe(1);
    expect(figures.listingErrors).toBe(1);
    expect(figures.firstListingError).toContain('Cannot connect');
    expect(s.latest()?.counted).toBe(10 * MIB);
  });

  test('a read that fails for another reason is counted against the container', async () => {
    container(1, 'db', 10);
    const s = new BudgetSampler({
      source,
      locator: tree.locator,
      now: () => clock,
      warn: (line) => warnings.push(line),
      read: () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    });
    await s.open();
    s.tick();
    s.tick();
    const db = s.figures().containers[0];
    expect(db?.readErrors).toBe(2);
    expect(db?.firstReadError).toBe('permission denied');
    expect(db?.goneMs).toBeNull();
    expect(s.figures().peak).toBeNull();
  });

  test('marks name moments of the run on the sampler’s clock', async () => {
    container(1, 'db', 10);
    const s = sampler();
    await s.open();
    clock += 3_000;
    s.mark('workload');
    expect(s.figures().marks).toEqual([{ label: 'workload', atMs: 3_000 }]);
  });
});

describe('BudgetSampler.run', () => {
  test('reads on the interval and lists again until stopped', async () => {
    const tree = fakeTree();
    try {
      const source = new FakeSource();
      source.add(1, 'db');
      tree.process(1001, scope(1));
      tree.stat(scope(1), { anon: MIB });
      const s = new BudgetSampler({
        source,
        locator: tree.locator,
        intervalMs: 20,
        discoveryMs: 30,
      });
      await s.open();
      s.run();
      await new Promise((resolve) => setTimeout(resolve, 230));
      const figures = await s.stop();
      expect(figures.instants).toBeGreaterThanOrEqual(6);
      expect(figures.instants).toBeLessThanOrEqual(14);
      expect(figures.listings).toBeGreaterThanOrEqual(3);
      const after = figures.instants;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(s.figures().instants).toBe(after);
    } finally {
      tree.close();
    }
  });
});
