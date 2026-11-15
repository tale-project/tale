import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readJournal, updateJournal } from '../runtime/incus/apply/journal';
import type { VolumeInfo } from '../runtime/incus/verbs/volumes';
import {
  admitSandboxHostMove,
  admitSandboxPlacement,
  clearSandboxPlacement,
  SANDBOX_HOST_MOVE_SENTENCES,
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

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** A stack whose running spawner (if any) has `config`. */
function hostRuntime(config?: Record<string, string>) {
  const stateRoot = mkdtempSync(join(tmpdir(), 'tale-host-move-'));
  roots.push(stateRoot);
  const instances =
    config === undefined
      ? []
      : [
          {
            name: 'sandbox',
            config: {
              'user.tale.stack': 'tale',
              'user.tale.service': 'sandbox',
              ...config,
            },
          },
        ];
  return {
    stack: 'tale',
    stateRoot,
    client: { listInstances: async () => instances },
  } as unknown as Parameters<typeof admitSandboxHostMove>[0];
}

const SINGLE = {
  'environment.SANDBOX_INCUS_ENDPOINT': 'https://10.30.0.1:8443',
  'environment.SANDBOX_INCUS_PROJECT': 'tale-sessions',
};

/** A target whose spawner takes the list `entries`. */
function listTarget(entries: { endpoint: string; project?: string }[]) {
  return {
    instances: [
      {
        service: 'sandbox',
        config: {
          'environment.SANDBOX_INCUS_ENDPOINTS': JSON.stringify(
            entries.map((entry, index) => ({
              name: `node-${index}`,
              ...entry,
            })),
          ),
          'environment.SANDBOX_INCUS_PROJECT': 'tale-sessions',
        },
      },
    ],
  } as unknown as Parameters<typeof admitSandboxHostMove>[1];
}

const OLD = { endpoint: 'https://10.30.0.1:8443', project: 'tale-sessions' };

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): the journal that keeps the one host is held by
// owner and mode, which Windows files do not carry, so it reads back there
// as a custody refusal.
const describePosix = describe.skipIf(process.platform === 'win32');

describePosix(
  'a stack that ran with the one sandbox host taking the list',
  () => {
    test('passes with an entry of its endpoint and project, either as written or by default', async () => {
      for (const entry of [
        { endpoint: 'https://10.30.0.1:8443/' },
        { endpoint: 'https://10.30.0.1:8443', project: 'tale-sessions' },
      ]) {
        const runtime = hostRuntime(SINGLE);
        await admitSandboxHostMove(
          runtime,
          listTarget([{ endpoint: 'https://10.0.0.2:8443' }, entry]),
          false,
        );
        expect((await readJournal(runtime.stateRoot))?.sandboxHost).toEqual(
          OLD,
        );
      }
    });

    test('is refused without one, naming the host, and neither a plan nor a deploy writes the journal', async () => {
      for (const entry of [
        { endpoint: 'https://10.0.0.2:8443' },
        { endpoint: 'https://10.30.0.1:8443', project: 'other' },
      ])
        for (const dryRun of [true, false]) {
          const runtime = hostRuntime(SINGLE);
          await expect(
            admitSandboxHostMove(runtime, listTarget([entry]), dryRun),
          ).rejects.toThrow(SANDBOX_HOST_MOVE_SENTENCES.unmatched(OLD));
          expect(await readJournal(runtime.stateRoot)).toBeNull();
        }
    });

    test('a spawner whose one endpoint is no https origin never ran a session, and holds the list to nothing', async () => {
      for (const endpoint of ['10.30.0.1:8443', 'http://10.30.0.1:8443']) {
        const runtime = hostRuntime({
          ...SINGLE,
          'environment.SANDBOX_INCUS_ENDPOINT': endpoint,
        });
        await admitSandboxHostMove(
          runtime,
          listTarget([{ endpoint: 'https://10.0.0.2:8443' }]),
          false,
        );
        expect(await readJournal(runtime.stateRoot)).toBeNull();
      }
    });

    test('a spawner of the list form, or none ever recorded, holds the list to nothing', async () => {
      const listed = hostRuntime({
        'environment.SANDBOX_INCUS_ENDPOINTS': '[]',
      });
      // The one host a deploy before the list recorded.
      await updateJournal(listed.stateRoot, 'tale', (journal) => {
        journal.sandboxHost = OLD;
      });
      await admitSandboxHostMove(
        listed,
        listTarget([{ endpoint: 'https://10.0.0.2:8443' }]),
        false,
      );
      expect((await readJournal(listed.stateRoot))?.sandboxHost).toBeNull();
      await admitSandboxHostMove(
        hostRuntime(),
        listTarget([{ endpoint: 'https://10.0.0.2:8443' }]),
        false,
      );
    });

    test('the single form stays free to move its one host', async () => {
      const runtime = hostRuntime(SINGLE);
      await admitSandboxHostMove(
        runtime,
        {
          instances: [
            {
              service: 'sandbox',
              config: {
                'environment.SANDBOX_INCUS_ENDPOINT': 'https://10.0.0.2:8443',
              },
            },
          ],
        } as unknown as Parameters<typeof admitSandboxHostMove>[1],
        false,
      );
    });
  },
);
