import { describe, expect, test } from 'bun:test';
import { rejects } from 'node:assert/strict';

import {
  DockerAdmissionOwner,
  HOST_ADMISSION_OWNER_NAME,
} from './host-admission-owner.ts';
import type { RunDockerResult } from './spawn-util.ts';

const CID = 'a'.repeat(64);
const RECORD = 'b'.repeat(64);
const BOOT = '12345678-abcd-1234-abcd-123456789012';
const START = '2026-10-08T01:00:00.123456789Z';
const IMAGE = `sha256:${'c'.repeat(64)}`;

function fixture() {
  const calls: string[][] = [];
  const limits: number[] = [];
  const state = {
    namespace: 'mnt:[100]\npid:[200]\n',
    boot: BOOT,
    running: true,
    startedAt: START,
    pidMode: '',
    recordId: RECORD,
    selfId: CID,
    imageId: IMAGE,
    recordImageId: IMAGE,
    labels: {} as Record<string, string>,
    recordStatus: 'created',
    daemon: 'daemon-id',
    conflict: false,
    lostAck: false,
    truncate: false,
    elapsed: 0,
    onComplete: undefined as ((args: string[]) => void) | undefined,
  };
  const result = (stdout: string, exitCode = 0): RunDockerResult => {
    state.onComplete?.(calls.at(-1) ?? []);
    return {
      stdout,
      exitCode,
      stderr: '',
      stdoutTruncated: state.truncate,
      stderrTruncated: false,
    };
  };
  const docker = (
    args: string[],
    timeoutMs: number,
  ): Promise<RunDockerResult> => {
    calls.push(args);
    limits.push(timeoutMs);
    if (args[0] === 'context')
      return Promise.resolve(
        result(JSON.stringify('unix:///var/run/docker.sock')),
      );
    if (args[0] === 'info')
      return Promise.resolve(result(JSON.stringify(state.daemon)));
    if (args[0] === 'inspect') {
      const metadata = args.at(-1) === HOST_ADMISSION_OWNER_NAME;
      return Promise.resolve(
        result(
          JSON.stringify({
            id: metadata ? state.recordId : state.selfId,
            image: metadata ? state.recordImageId : state.imageId,
            startedAt: metadata ? '0001-01-01T00:00:00Z' : state.startedAt,
            running: metadata ? false : state.running,
            status: metadata ? state.recordStatus : 'running',
            pidMode: metadata ? '' : state.pidMode,
            labels: metadata ? state.labels : {},
          }),
        ),
      );
    }
    if (args[0] === 'exec')
      return Promise.resolve(
        result(args[2] === 'cat' ? state.boot : state.namespace),
      );
    if (args[0] === 'create') {
      if (!state.conflict) {
        for (let index = 0; index < args.length; index++) {
          if (args[index] !== '--label') continue;
          const entry = args[index + 1] ?? '';
          const separator = entry.indexOf('=');
          state.labels[entry.slice(0, separator)] = entry.slice(separator + 1);
        }
      }
      return Promise.resolve(
        result(
          state.lostAck ? '' : RECORD,
          state.conflict || state.lostAck ? 1 : 0,
        ),
      );
    }
    throw new Error('Unexpected Docker call');
  };
  const owner = new DockerAdmissionOwner({
    docker,
    platform: 'linux',
    env: { HOSTNAME: CID.slice(0, 12) },
    readFile: () => Promise.resolve(`${BOOT}\n`),
    readlink: (path) =>
      Promise.resolve(path.endsWith('/mnt') ? 'mnt:[100]' : 'pid:[200]'),
    monotonic: () => state.elapsed,
  });
  return { owner, state, calls, limits, docker };
}

describe('inactive native lifetime owner foundation', () => {
  test('proves exact self namespaces/kernel and uses immutable self image for a stopped record', async () => {
    const { owner, state, calls, limits } = fixture();
    const identity = await owner.acquire();
    expect(identity).toMatchObject({
      containerId: CID,
      recordId: RECORD,
      imageId: IMAGE,
      hostBootId: BOOT,
      startedAt: START,
    });
    const create = calls.find((args) => args[0] === 'create');
    expect(create).toContain(HOST_ADMISSION_OWNER_NAME);
    expect(create?.at(-1)).toBe(IMAGE);
    expect(create).toContain('--read-only');
    expect(create).toContain('no-new-privileges');
    expect(
      calls
        .filter((args) => args[0] === 'exec')
        .every((args) => args[1] === CID),
    ).toBe(true);
    expect(state.labels['tale.host-admission.generation']).toBe(
      identity.generation,
    );
    expect(limits.every((value) => value > 0 && value <= 5_000)).toBe(true);
    await owner.assertCurrent();
    expect(await owner.acquire()).toEqual(identity);
    expect(calls.filter((args) => args[0] === 'create')).toHaveLength(1);
  });

  test('a lost create acknowledgement may reconcile only its exact generation', async () => {
    const { owner, state } = fixture();
    state.lostAck = true;
    expect(await owner.acquire()).toMatchObject({ recordId: RECORD });
  });

  test('a stale but live owner is never stolen, even from the same container incarnation', async () => {
    const { owner, state, calls } = fixture();
    state.conflict = true;
    state.labels = { 'tale.host-admission.generation': 'other' };
    await rejects(owner.acquire(), new RegExp('held'));
    expect(
      calls.some((args) =>
        ['rm', 'stop', 'kill', 'rename'].includes(args[0] ?? ''),
      ),
    ).toBe(false);
    await rejects(owner.assertCurrent(), new RegExp('not acquired'));
  });

  test.each(['namespace', 'boot', 'pidMode', 'running', 'truncate'] as const)(
    'refuses invalid %s before any ownership write',
    async (field) => {
      const { owner, state, calls } = fixture();
      if (field === 'namespace') state.namespace = 'mnt:[101]\npid:[200]\n';
      if (field === 'boot') state.boot = '87654321-abcd-1234-abcd-123456789012';
      if (field === 'pidMode') state.pidMode = 'host';
      if (field === 'running') state.running = false;
      if (field === 'truncate') state.truncate = true;
      await rejects(owner.acquire());
      expect(calls.some((args) => args[0] === 'create')).toBe(false);
    },
  );

  test.each([
    'recordId',
    'selfId',
    'imageId',
    'recordImageId',
    'recordStatus',
    'daemon',
    'startedAt',
    'labels',
  ] as const)('refuses changed %s on use', async (field) => {
    const { owner, state } = fixture();
    await owner.acquire();
    if (field === 'recordId') state.recordId = 'd'.repeat(64);
    if (field === 'selfId') state.selfId = 'd'.repeat(64);
    if (field === 'imageId') state.imageId = `sha256:${'d'.repeat(64)}`;
    if (field === 'recordImageId')
      state.recordImageId = `sha256:${'d'.repeat(64)}`;
    if (field === 'recordStatus') state.recordStatus = 'exited';
    if (field === 'daemon') state.daemon = 'other';
    if (field === 'startedAt') state.startedAt = '2026-10-08T02:00:00.123Z';
    if (field === 'labels')
      state.labels['tale.host-admission.generation'] = 'other';
    await rejects(owner.assertCurrent(), new RegExp('changed'));
  });

  test('a restart during the self challenge refuses before create', async () => {
    const { state, calls, docker } = fixture();
    const owner = new DockerAdmissionOwner({
      platform: 'linux',
      env: { HOSTNAME: CID },
      docker: async (args, timeout) => {
        const result = await docker(args, timeout);
        if (args[0] === 'exec') state.startedAt = '2026-10-08T02:00:00.123Z';
        return result;
      },
      readFile: () => Promise.resolve(BOOT),
      readlink: (path) =>
        Promise.resolve(path.endsWith('/mnt') ? 'mnt:[100]' : 'pid:[200]'),
    });
    await rejects(owner.acquire(), new RegExp('incarnation changed'));
    expect(calls.some((args) => args[0] === 'create')).toBe(false);
  });

  test('a slow read consumes the shared deadline instead of acquiring a fresh budget', async () => {
    const { state, calls, docker } = fixture();
    const owner = new DockerAdmissionOwner({
      platform: 'linux',
      env: { HOSTNAME: CID },
      docker: (args, timeout) => {
        state.elapsed += 10_000;
        return docker(args, timeout);
      },
      monotonic: () => state.elapsed,
      readFile: () => Promise.resolve(BOOT),
      readlink: (path) =>
        Promise.resolve(path.endsWith('/mnt') ? 'mnt:[100]' : 'pid:[200]'),
    });
    await rejects(owner.acquire(), new RegExp('deadline'));
    expect(calls.some((args) => args[0] === 'create')).toBe(false);
  });

  test('a late final acquire read refuses authority and retains the record', async () => {
    const { owner, state, calls } = fixture();
    state.onComplete = (args) => {
      if (
        args[0] === 'inspect' &&
        args.at(-1) === CID &&
        calls.some(
          (call) =>
            call[0] === 'inspect' && call.at(-1) === HOST_ADMISSION_OWNER_NAME,
        )
      )
        state.elapsed = 30_001;
    };
    await rejects(owner.acquire(), /deadline/);
    expect(calls.at(-1)?.at(-1)).toBe(CID);
    expect(state.labels['tale.host-admission.generation']).toBeString();
    expect(
      calls.some((args) =>
        ['rm', 'stop', 'kill', 'rename'].includes(args[0] ?? ''),
      ),
    ).toBe(false);
    await rejects(owner.assertCurrent(), /not acquired/);
  });

  test('a late final use-time read refuses even without another Docker call', async () => {
    const { owner, state, calls } = fixture();
    const acquired = await owner.acquire();
    state.onComplete = (args) => {
      if (args[0] === 'info') state.elapsed = 15_001;
    };
    await rejects(owner.assertCurrent(), /deadline/);
    expect(calls.at(-1)?.[0]).toBe('info');
    expect(state.labels['tale.host-admission.generation']).toBe(
      acquired.generation,
    );
    expect(
      calls.some((args) =>
        ['rm', 'stop', 'kill', 'rename'].includes(args[0] ?? ''),
      ),
    ).toBe(false);
  });

  test('a parent budget shortens every use-time Docker call and cannot accept a late final read', async () => {
    const { owner, state, calls, limits } = fixture();
    const acquired = await owner.acquire();
    const begin = limits.length;
    state.onComplete = () => {
      state.elapsed += 20;
    };
    await owner.assertCurrent(100);
    expect(limits.slice(begin)).toEqual([100, 80, 60]);
    state.onComplete = (args) => {
      if (args[0] === 'info') state.elapsed += 100;
    };
    await rejects(owner.assertCurrent(100), /deadline/);
    expect(calls.at(-1)?.[0]).toBe('info');
    expect(state.labels['tale.host-admission.generation']).toBe(
      acquired.generation,
    );
    expect(
      calls.some((args) =>
        ['rm', 'stop', 'kill', 'rename'].includes(args[0] ?? ''),
      ),
    ).toBe(false);
  });

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 15_001])(
    'invalid or extended parent budget %s refuses before Docker access',
    async (budget) => {
      const { owner, calls } = fixture();
      await owner.acquire();
      const before = calls.length;
      await rejects(owner.assertCurrent(budget), /budget/);
      expect(calls).toHaveLength(before);
    },
  );

  test.each([false, true])(
    'a late create with lost acknowledgement=%s remains held',
    async (lostAck) => {
      const { owner, state, calls } = fixture();
      state.lostAck = lostAck;
      state.onComplete = (args) => {
        if (args[0] === 'create') state.elapsed = 30_001;
      };
      await rejects(owner.acquire(), /deadline/);
      expect(calls.at(-1)?.[0]).toBe('create');
      expect(state.labels['tale.host-admission.generation']).toBeString();
      expect(
        calls.some((args) =>
          ['rm', 'stop', 'kill', 'rename'].includes(args[0] ?? ''),
        ),
      ).toBe(false);
      await rejects(owner.assertCurrent(), /not acquired/);
    },
  );

  test('remote endpoints and non-Linux/unidentified processes have no authority path', async () => {
    const { calls, docker } = fixture();
    for (const config of [
      { platform: 'darwin', env: { HOSTNAME: CID } },
      { platform: 'linux', env: { HOSTNAME: 'friendly-name' } },
      {
        platform: 'linux',
        env: { HOSTNAME: CID, DOCKER_HOST: 'tcp://host:2375' },
      },
    ])
      await rejects(new DockerAdmissionOwner({ ...config, docker }).acquire());
    expect(calls).toHaveLength(0);
  });
});

function recoveryFixture() {
  const priorCid = 'd'.repeat(64);
  const nextRecord = 'e'.repeat(64);
  const priorGeneration = '11111111-1111-4111-8111-111111111111';
  const priorLabels = {
    'tale.host-admission.version': '1',
    'tale.host-admission.daemon': 'daemon-id',
    'tale.host-admission.boot': BOOT,
    'tale.host-admission.container': priorCid,
    'tale.host-admission.started': START,
    'tale.host-admission.generation': priorGeneration,
  };
  const state = {
    priorRunning: false,
    priorStatus: 'exited',
    priorPresent: true,
    priorImage: IMAGE,
    failCreateAfterRename: false,
    recordName: HOST_ADMISSION_OWNER_NAME,
    currentLabels: null as Record<string, string> | null,
  };
  const calls: string[][] = [];
  const result = (stdout: string, exitCode = 0): RunDockerResult => ({
    stdout,
    exitCode,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
  });
  const docker = (args: string[]): Promise<RunDockerResult> => {
    calls.push(args);
    if (args[0] === 'context')
      return Promise.resolve(
        result(JSON.stringify('unix:///var/run/docker.sock')),
      );
    if (args[0] === 'info')
      return Promise.resolve(result(JSON.stringify('daemon-id')));
    if (args[0] === 'exec')
      return Promise.resolve(
        result(args[2] === 'cat' ? BOOT : 'mnt:[100]\npid:[200]\n'),
      );
    if (args[0] === 'create') {
      if (state.recordName === HOST_ADMISSION_OWNER_NAME || state.currentLabels)
        return Promise.resolve(result('', 1));
      if (state.failCreateAfterRename)
        throw new Error('transport lost after rename');
      state.currentLabels = {};
      for (let i = 0; i < args.length; i++)
        if (args[i] === '--label') {
          const label = args[i + 1] ?? '';
          const split = label.indexOf('=');
          state.currentLabels[label.slice(0, split)] = label.slice(split + 1);
        }
      return Promise.resolve(result(nextRecord));
    }
    if (args[0] === 'rename') {
      expect(args[1]).toBe(RECORD);
      state.recordName = args[2] ?? '';
      return Promise.resolve(result(''));
    }
    if (args[0] === 'ps')
      return Promise.resolve(
        result(
          args.includes(`id=${priorCid}`)
            ? state.priorPresent
              ? `${priorCid}\n`
              : ''
            : `${RECORD}\n`,
        ),
      );
    if (args[0] === 'inspect') {
      const target = args.at(-1);
      const prior = target === priorCid;
      const oldRecord =
        target === RECORD ||
        (target === HOST_ADMISSION_OWNER_NAME && state.currentLabels === null);
      const currentRecord =
        target === HOST_ADMISSION_OWNER_NAME && state.currentLabels !== null;
      return Promise.resolve(
        result(
          JSON.stringify({
            id: prior
              ? priorCid
              : oldRecord
                ? RECORD
                : currentRecord
                  ? nextRecord
                  : CID,
            image: prior ? state.priorImage : IMAGE,
            startedAt:
              oldRecord || currentRecord ? '0001-01-01T00:00:00Z' : START,
            running: prior ? state.priorRunning : !oldRecord && !currentRecord,
            status: prior
              ? state.priorStatus
              : oldRecord || currentRecord
                ? 'created'
                : 'running',
            pidMode: '',
            labels: oldRecord
              ? priorLabels
              : currentRecord
                ? state.currentLabels
                : {},
          }),
        ),
      );
    }
    throw new Error('Unexpected recovery call');
  };
  const make = () =>
    new DockerAdmissionOwner({
      docker,
      platform: 'linux',
      env: { HOSTNAME: CID.slice(0, 12) },
      readFile: () => Promise.resolve(`${BOOT}\n`),
      readlink: (path) =>
        Promise.resolve(path.endsWith('/mnt') ? 'mnt:[100]' : 'pid:[200]'),
      monotonic: () => 0,
    });
  return {
    state,
    calls,
    make,
    prior: {
      daemonId: 'daemon-id',
      hostBootId: BOOT,
      authorityGeneration: priorGeneration,
      filesystemId: 'old-filesystem',
    },
  };
}

describe('native owner restart lineage', () => {
  test('known ended owner is retained under immutable history name and its generation can be reconciled', async () => {
    const { make, calls, prior } = recoveryFixture();
    const owner = make();
    expect(await owner.acquire(true)).toMatchObject({
      recordId: 'e'.repeat(64),
    });
    await owner.assertPriorRetired(prior);
    expect(calls.filter((args) => args[0] === 'rename')).toEqual([
      ['rename', RECORD, `${HOST_ADMISSION_OWNER_NAME}-retired-${RECORD}`],
    ]);
    expect(
      calls.some((args) => ['rm', 'stop', 'kill'].includes(args[0] ?? '')),
    ).toBe(false);
  });
  test.each(['running', 'restarting', 'image'] as const)(
    'a %s predecessor is not stolen',
    async (fault) => {
      const { make, state, calls } = recoveryFixture();
      if (fault === 'running') state.priorRunning = true;
      if (fault === 'restarting') state.priorStatus = 'restarting';
      if (fault === 'image') state.priorImage = `sha256:${'f'.repeat(64)}`;
      await rejects(make().acquire(true), /still active or changed/);
      expect(calls.some((args) => args[0] === 'rename')).toBe(false);
    },
  );
  test('an exactly absent predecessor can be retired but returning live predecessor cannot certify journal transfer', async () => {
    const { make, state, prior } = recoveryFixture();
    state.priorPresent = false;
    const owner = make();
    await owner.acquire(true);
    state.priorPresent = true;
    state.priorRunning = true;
    await rejects(owner.assertPriorRetired(prior), /still active or changed/);
  });
  test('a crash after rename preserves enough lineage for a fresh owner process', async () => {
    const { make, state, prior } = recoveryFixture();
    state.failCreateAfterRename = true;
    await rejects(make().acquire(true), /transport lost/);
    state.failCreateAfterRename = false;
    const fresh = make();
    await fresh.acquire(true);
    await fresh.assertPriorRetired(prior);
    expect(state.recordName).toContain('-retired-');
  });
});
