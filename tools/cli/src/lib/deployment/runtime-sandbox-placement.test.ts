import { describe, expect, test } from 'bun:test';

import type { VolumeInfo } from '../runtime/incus/verbs/volumes';
import {
  admitSandboxPlacement,
  clearSandboxPlacement,
  SANDBOX_PLACEMENT_SENTENCES,
} from './runtime-sandbox-placement';

function runtimeOf(volumes: VolumeInfo[]) {
  const removed: string[] = [];
  return {
    removed,
    listVolumes: async () => volumes,
    removeVolume: async (name: string) => {
      removed.push(name);
      return true;
    },
  };
}

const record: VolumeInfo = { name: 'sandbox-state', kind: 'data', usedBy: [] };
const data: VolumeInfo = { name: 'db-data', kind: 'data', usedBy: ['db'] };

describe("the spawner's placement record when a deployment leaves the list form", () => {
  test('the list form keeps its record and needs no flag', async () => {
    expect(await admitSandboxPlacement(runtimeOf([record]), true, false)).toBe(
      false,
    );
  });

  test('the flag beside the list is refused: its spawner reads the record', async () => {
    await expect(
      admitSandboxPlacement(runtimeOf([record]), true, true),
    ).rejects.toThrow(SANDBOX_PLACEMENT_SENTENCES.listed);
  });

  test('the single form over a kept record is refused without the flag', async () => {
    await expect(
      admitSandboxPlacement(runtimeOf([data, record]), false, false),
    ).rejects.toThrow(SANDBOX_PLACEMENT_SENTENCES.kept);
  });

  test('the single form with the flag clears the record after the apply', async () => {
    expect(
      await admitSandboxPlacement(runtimeOf([data, record]), false, true),
    ).toBe(true);
  });

  test('the single form without a record needs nothing, with or without the flag', async () => {
    for (const clear of [false, true])
      expect(await admitSandboxPlacement(runtimeOf([data]), false, clear)).toBe(
        false,
      );
  });

  test('the clear deletes an unmounted record, and a plan deletes nothing', async () => {
    const planned = runtimeOf([record]);
    await clearSandboxPlacement(planned, true);
    expect(planned.removed).toEqual([]);
    const applied = runtimeOf([record]);
    await clearSandboxPlacement(applied, false);
    expect(applied.removed).toEqual(['sandbox-state']);
  });

  test('the clear keeps a record an instance still mounts', async () => {
    const mounted = runtimeOf([{ ...record, usedBy: ['sandbox'] }]);
    await clearSandboxPlacement(mounted, false);
    expect(mounted.removed).toEqual([]);
  });
});
