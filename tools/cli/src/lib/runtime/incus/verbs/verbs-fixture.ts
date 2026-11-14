// Test support for the exec, file, log, helper and health verbs: a fake
// Incus with the stack project, a state root, and the image facts an exec
// reads its `timeout` from. Not imported by anything the CLI ships.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IncusConfigMap, IncusDevices } from '@tale/incus/api';
import type { FakeIncus, FakeInstance } from '@tale/incus/fake';

import { stackIncus } from '../apply/apply-fixture';
import { incusStateDirectory } from '../plan/digest';
import type { IncusVerbContext } from './exec';
import { IMAGE_FACTS_FILE } from './image-facts-cache';

export const STACK = 'tale';
export const POOL = 'tale';
/** An image whose facts name `timeout`, and one whose do not. */
export const WITH_TIMEOUT = `sha256:${'1'.repeat(64)}`;
export const WITHOUT_TIMEOUT = `sha256:${'2'.repeat(64)}`;

export interface VerbsFixture {
  fake: FakeIncus;
  context: IncusVerbContext;
  stateRoot: string;
  remove(): void;
}

/** A fake Incus, a state root, and the facts of the two images. */
export function verbsFixture(): VerbsFixture {
  const fake = stackIncus();
  const stateRoot = mkdtempSync(join(tmpdir(), 'tale-incus-verbs-'));
  const directory = incusStateDirectory(stateRoot);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const facts = (digest: string, timeout: string | null) => ({
    digest,
    paths: {},
    appUser: { uid: 1001, gid: 1001 },
    timeout,
    infraFormats: [],
    readAt: '2026-11-13T00:00:00.000Z',
  });
  writeFileSync(
    join(directory, IMAGE_FACTS_FILE),
    JSON.stringify({
      schemaVersion: 1,
      images: {
        [WITH_TIMEOUT]: facts(WITH_TIMEOUT, '/usr/bin/timeout'),
        [WITHOUT_TIMEOUT]: facts(WITHOUT_TIMEOUT, null),
      },
    }),
    { mode: 0o600 },
  );
  return {
    fake,
    context: { client: fake.client(), stack: STACK, stateRoot },
    stateRoot,
    remove() {
      fake.close();
      rmSync(stateRoot, { recursive: true, force: true });
    },
  };
}

/** One of the stack's instances, running unless told otherwise. */
export function seedStackInstance(
  fake: FakeIncus,
  name: string,
  options: {
    service?: string;
    image?: string;
    config?: IncusConfigMap;
    devices?: IncusDevices;
    status?: FakeInstance['status'];
    files?: Record<string, string>;
  } = {},
): FakeInstance {
  const instance = fake.seedInstance(
    name,
    {
      'user.tale.stack': STACK,
      'user.tale.service': options.service ?? name,
      'user.tale.role': options.service ?? name,
      'user.tale.image': options.image ?? WITH_TIMEOUT,
      'user.tale.want': 'running',
      ...options.config,
    },
    {
      ephemeral: false,
      status: options.status ?? 'Running',
      devices: options.devices ?? {},
    },
  );
  for (const [path, content] of Object.entries(options.files ?? {}))
    instance.files.set(path, { content, mode: '0644', uid: 0, gid: 0 });
  return instance;
}

/** A volume of the stack (`user.tale.stack`), or of another one. */
export function seedStackVolume(
  fake: FakeIncus,
  name: string,
  stack = STACK,
): void {
  fake.seedVolume(name, { 'user.tale.stack': stack });
}
