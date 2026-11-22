import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import {
  containerCgroupPath,
  conventionalCgroupPaths,
  isUnifiedHierarchy,
  parseMemoryStat,
  readMemoryStat,
  resolveContainerCgroup,
  unifiedCgroupPath,
} from '../../src/budget/cgroup.ts';
import { type FakeTree, fakeTree, statText } from './fake-cgroup.ts';

const ID = 'a'.repeat(64);

describe('parseMemoryStat', () => {
  test('counts the six decided fields and reports the page cache beside them', () => {
    const reading = parseMemoryStat(
      statText({
        anon: 100,
        shmem: 20,
        slab_unreclaimable: 3,
        kernel_stack: 4,
        pagetables: 5,
        sock: 6,
        file: 1_000,
        slab_reclaimable: 7_000,
        kernel: 9_000,
        percpu: 50,
      }),
    );
    expect(reading).toEqual({
      counted: 138,
      file: 1_000,
      fields: {
        anon: 100,
        shmem: 20,
        slab_unreclaimable: 3,
        kernel_stack: 4,
        pagetables: 5,
        sock: 6,
      },
    });
  });

  test('a file without a counted field or without file is no reading', () => {
    const withoutSock = statText({ anon: 1 }).replace(/^sock .*\n/m, '');
    expect(parseMemoryStat(withoutSock)).toBeNull();
    const withoutFile = statText({ anon: 1 }).replace(/^file .*\n/m, '');
    expect(parseMemoryStat(withoutFile)).toBeNull();
    // A cgroup v1 memory.stat names other fields altogether.
    expect(parseMemoryStat('cache 4096\nrss 8192\nmapped_file 0\n')).toBeNull();
  });
});

describe('where a container’s cgroup is', () => {
  test('the unified line of /proc/<pid>/cgroup, also beside v1 lines', () => {
    expect(unifiedCgroupPath(`0::/system.slice/docker-${ID}.scope\n`)).toBe(
      `/system.slice/docker-${ID}.scope`,
    );
    expect(
      unifiedCgroupPath(
        `12:memory:/docker/${ID}\n1:name=systemd:/docker/${ID}\n0::/docker/${ID}\n`,
      ),
    ).toBe(`/docker/${ID}`);
    expect(unifiedCgroupPath(`12:memory:/docker/${ID}\n`)).toBeNull();
  });

  test('a process in a child cgroup still reads its whole container', () => {
    expect(
      containerCgroupPath(`/system.slice/docker-${ID}.scope/init.scope`, ID),
    ).toBe(`/system.slice/docker-${ID}.scope`);
    expect(containerCgroupPath(`/docker/${ID}/child`, ID)).toBe(
      `/docker/${ID}`,
    );
    // An operator's cgroup parent keeps its own path above the container.
    expect(containerCgroupPath(`/custom.slice/docker-${ID}.scope`, ID)).toBe(
      `/custom.slice/docker-${ID}.scope`,
    );
  });

  test('a cgroup that names no container is not the container’s', () => {
    // A rootless engine's processes in the user's service, a cgroup
    // namespace's root, or another container's cgroup.
    expect(
      containerCgroupPath(
        '/user.slice/user-1000.slice/user@1000.service/app.slice/docker.service',
        ID,
      ),
    ).toBeNull();
    expect(containerCgroupPath('/', ID)).toBeNull();
    expect(
      containerCgroupPath(`/system.slice/docker-${'b'.repeat(64)}.scope`, ID),
    ).toBeNull();
    expect(containerCgroupPath('/docker/anything', '')).toBeNull();
  });

  test('the conventional paths, the engine’s own driver first', () => {
    expect(conventionalCgroupPaths(ID, 'systemd').map((c) => c.via)).toEqual([
      'systemd',
      'cgroupfs',
    ]);
    expect(conventionalCgroupPaths(ID, 'cgroupfs')).toEqual([
      { path: `/docker/${ID}`, via: 'cgroupfs' },
      { path: `/system.slice/docker-${ID}.scope`, via: 'systemd' },
    ]);
  });
});

describe('resolveContainerCgroup', () => {
  let tree: FakeTree;
  afterEach(() => tree.close());

  test('the systemd driver, through the container’s process', () => {
    tree = fakeTree();
    tree.stat(`/system.slice/docker-${ID}.scope`, { anon: 1 });
    tree.process(4242, `/system.slice/docker-${ID}.scope/init.scope`);
    expect(
      resolveContainerCgroup(tree.locator, {
        id: ID,
        pid: 4242,
        driver: 'systemd',
      }),
    ).toEqual({
      dir: join(tree.locator.root, `/system.slice/docker-${ID}.scope`),
      via: 'proc',
    });
  });

  test('the cgroupfs driver, through the container’s process', () => {
    tree = fakeTree();
    tree.stat(`/docker/${ID}`, { anon: 1 });
    tree.process(7, `/docker/${ID}`);
    expect(
      resolveContainerCgroup(tree.locator, {
        id: ID,
        pid: 7,
        driver: 'cgroupfs',
      }),
    ).toEqual({ dir: join(tree.locator.root, `/docker/${ID}`), via: 'proc' });
  });

  test('without a readable process, the drivers’ conventional paths', () => {
    tree = fakeTree();
    tree.stat(`/docker/${ID}`, { anon: 1 });
    expect(
      resolveContainerCgroup(tree.locator, {
        id: ID,
        pid: 99,
        driver: 'systemd',
      }),
    ).toEqual({
      dir: join(tree.locator.root, `/docker/${ID}`),
      via: 'cgroupfs',
    });
    expect(
      resolveContainerCgroup(tree.locator, {
        id: 'b'.repeat(64),
        pid: 0,
        driver: null,
      }),
    ).toBeNull();
  });

  test('a process in a cgroup that names another container, or none, leads to the conventional paths alone', () => {
    tree = fakeTree();
    const other = `/system.slice/docker-${'c'.repeat(64)}.scope`;
    tree.stat(other, { anon: 300 });
    // The pid was taken by a process of another container.
    tree.process(4242, other);
    expect(
      resolveContainerCgroup(tree.locator, {
        id: ID,
        pid: 4242,
        driver: 'systemd',
      }),
    ).toBeNull();
    // Shared by every container (the review's probe): no candidate at all.
    const shared =
      '/user.slice/user-1000.slice/user@1000.service/app.slice/docker.service';
    tree.stat(shared, { anon: 300 });
    tree.process(4343, shared);
    expect(
      resolveContainerCgroup(tree.locator, {
        id: ID,
        pid: 4343,
        driver: 'cgroupfs',
      }),
    ).toBeNull();
    // Its own conventional cgroup is still found.
    tree.stat(`/docker/${ID}`, { anon: 5 });
    expect(
      resolveContainerCgroup(tree.locator, {
        id: ID,
        pid: 4343,
        driver: 'cgroupfs',
      }),
    ).toEqual({
      dir: join(tree.locator.root, `/docker/${ID}`),
      via: 'cgroupfs',
    });
  });

  test('a unified mount is recognised by its cgroup.controllers', () => {
    tree = fakeTree();
    expect(isUnifiedHierarchy(tree.locator.root)).toBe(true);
    expect(isUnifiedHierarchy(tree.locator.proc)).toBe(false);
  });

  test('readMemoryStat refuses a file that is no reading, and throws what the read throws', () => {
    tree = fakeTree();
    tree.stat('/odd', {});
    const dir = join(tree.locator.root, '/odd');
    expect(readMemoryStat(dir).counted).toBe(0);
    expect(() => readMemoryStat(join(tree.locator.root, '/missing'))).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    );
  });
});
