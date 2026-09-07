import { describe, expect, mock, test } from 'bun:test';

import {
  migrateConfigVolume,
  type MigrateConfigVolumeDeps,
} from './migrate-config-volume';

/**
 * The regression this guards: Docker cannot rename a volume, so changing the
 * config store's name in the compose files alone mounts a NEW, EMPTY volume
 * and the deployment comes up with every organization's configuration gone —
 * silently, because the backend re-seeds builtin defaults on top of nothing.
 *
 * The three decisions that make the copy safe are pinned here: it is driven
 * by CONTENT (not existence — `ensureVolumes` pre-creates the target on every
 * run), the writers are paused for the copy, and a failed copy throws with
 * the old volume untouched rather than leaving a half-copied store live.
 */

const OK = { success: true, stdout: '', stderr: '', exitCode: 0 };
const FAIL = { success: false, stdout: '', stderr: 'boom', exitCode: 1 };

/** `exec` double routed by what the docker argv is doing. */
function fakeDeps(options: {
  content: Record<string, boolean>;
  copyFails?: boolean;
  createFails?: boolean;
  probeFails?: Record<string, boolean>;
}): MigrateConfigVolumeDeps & { calls: string[][] } {
  const calls: string[][] = [];
  // Plain functions, not `mock()`: bun's mock.module from sibling files
  // rebinds the shared mock implementation and would make a volume that
  // should be empty look full.
  const exec = (_cmd: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'volume' && args[1] === 'create') {
      return Promise.resolve(options.createFails ? FAIL : OK);
    }
    const script = args[args.length - 1] ?? '';
    if (script.startsWith('cp -a')) {
      return Promise.resolve(options.copyFails ? FAIL : OK);
    }
    if (script.startsWith('find /to')) {
      return Promise.resolve(OK);
    }
    // Content probe: success + nonempty stdout means the volume has files.
    // Success + empty stdout is an empty volume. Failure throws — it is
    // not treated as empty.
    const mounted = args.find((arg) => arg.includes(':/data:ro')) ?? '';
    const volume = mounted.split(':')[0] ?? '';
    if (options.probeFails?.[volume] === true) {
      return Promise.resolve(FAIL);
    }
    return Promise.resolve(
      options.content[volume] === true ? { ...OK, stdout: '/data/org\n' } : OK,
    );
  };
  return {
    calls,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    exec: exec as unknown as MigrateConfigVolumeDeps['exec'],
    volumeExists: (name: string) => Promise.resolve(name in options.content),
    withVolumeContainersPaused: mock(
      (_volumes: readonly string[], work: (paused: number) => Promise<void>) =>
        work(2),
    ) as unknown as MigrateConfigVolumeDeps['withVolumeContainersPaused'],
    logger: { step: mock(), info: mock(), success: mock() },
  };
}

function copyScripts(calls: string[][]): string[][] {
  return calls.filter((args) => String(args[args.length - 1]).startsWith('cp'));
}

describe('migrateConfigVolume', () => {
  test('does nothing when the store already lives in config-data', async () => {
    const deps = fakeDeps({
      content: { 'tale_config-data': true, 'tale_convex-data': true },
    });

    expect(await migrateConfigVolume('tale_', deps)).toBe('current');
    expect(copyScripts(deps.calls)).toHaveLength(0);
  });

  test('does nothing on a fresh install', async () => {
    const deps = fakeDeps({ content: {} });

    expect(await migrateConfigVolume('tale_', deps)).toBe('fresh');
    expect(copyScripts(deps.calls)).toHaveLength(0);
  });

  // The load-bearing case: `ensureVolumes` runs on every deploy, so the
  // target volume EXISTS but is empty on the first upgrade. Deciding on
  // existence would skip the copy and lose the config.
  test('copies when the target exists but is empty', async () => {
    const deps = fakeDeps({
      content: { 'tale_config-data': false, 'tale_convex-data': true },
    });

    expect(await migrateConfigVolume('tale_', deps)).toBe('copied');
    const copies = copyScripts(deps.calls);
    expect(copies).toHaveLength(1);
    // Contents, dotfiles included, with mode and ownership preserved — the
    // store holds *.secrets.json the app user has to read back.
    expect(copies[0]?.[copies[0].length - 1]).toBe('cp -a /from/. /to/');
    expect(copies[0]).toContain('tale_convex-data:/from:ro');
    expect(copies[0]).toContain('tale_config-data:/to');
  });

  test('pauses the writers of both volumes around the copy', async () => {
    const deps = fakeDeps({
      content: { 'tale_config-data': false, 'tale_convex-data': true },
    });

    await migrateConfigVolume('tale_', deps);

    expect(deps.withVolumeContainersPaused).toHaveBeenCalledWith(
      ['tale_convex-data', 'tale_config-data'],
      expect.any(Function),
    );
  });

  test('labels the volume it creates so `tale reset` can prune it', async () => {
    const deps = fakeDeps({
      content: { 'tale_config-data': false, 'tale_convex-data': true },
    });

    await migrateConfigVolume('tale_', deps);

    const create = deps.calls.find(
      (args) => args[0] === 'volume' && args[1] === 'create',
    );
    expect(create).toEqual([
      'volume',
      'create',
      '--label',
      'project=tale',
      'tale_config-data',
    ]);
  });

  test('uses the dev prefix as given', async () => {
    const deps = fakeDeps({
      content: { 'tale-dev_config-data': false, 'tale-dev_convex-data': true },
    });

    expect(await migrateConfigVolume('tale-dev_', deps)).toBe('copied');
    const create = deps.calls.find(
      (args) => args[0] === 'volume' && args[1] === 'create',
    );
    expect(create).toContain('project=tale-dev');
  });

  // The caller aborts on a throw, so the deployment keeps mounting the old
  // name rather than coming up on a half-copied store.
  test('throws with the old volume named when the copy fails', async () => {
    const deps = fakeDeps({
      content: { 'tale_config-data': false, 'tale_convex-data': true },
      copyFails: true,
    });

    await expect(migrateConfigVolume('tale_', deps)).rejects.toThrow(
      /still intact in tale_convex-data/,
    );
    expect(
      deps.calls.some((args) =>
        String(args[args.length - 1]).startsWith('find /to'),
      ),
    ).toBe(true);
  });

  test('throws when the content probe fails instead of treating it as empty', async () => {
    const deps = fakeDeps({
      content: { 'tale_convex-data': true },
      probeFails: { 'tale_convex-data': true },
    });

    await expect(migrateConfigVolume('tale_', deps)).rejects.toThrow(
      /Could not inspect tale_convex-data/,
    );
    expect(copyScripts(deps.calls)).toHaveLength(0);
  });

  test('throws without copying when the target volume cannot be created', async () => {
    const deps = fakeDeps({
      content: { 'tale_config-data': false, 'tale_convex-data': true },
      createFails: true,
    });

    await expect(migrateConfigVolume('tale_', deps)).rejects.toThrow(
      /nothing was migrated/,
    );
    expect(copyScripts(deps.calls)).toHaveLength(0);
  });
});
