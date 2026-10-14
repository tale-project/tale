// What every suite shares: the lab, the administrator, a way to start spawners
// and to find a session's objects on the node, and a `step` that says what the
// node and the spawners looked like when a step failed.

import { afterAll, setDefaultTimeout, test } from 'bun:test';
import { randomUUID } from 'node:crypto';

import type { IncusVolume } from '../../src/backend/incus/incus-api.ts';
import {
  incusInstanceName,
  incusWorkspaceVolumeName,
  LABEL,
  label,
} from '../../src/backend/incus/incus-naming.ts';
import { Admin, type AdminInstance } from './admin.ts';
import { loadLab, reportDir } from './lab-config.ts';
import { Report } from './report.ts';
import {
  field,
  type Reply,
  type SpawnerApi,
  watchSlowCreates,
} from './spawner-api.ts';
import { Spawner, type SpawnerSettings } from './spawner.ts';
import { asText, describeError } from './util.ts';

// A cold create waits for DHCP and runnerd; the first suite also pulls the
// runtime image. Nothing here is quick, and nothing hangs for good: every wait
// has its own deadline.
const STEP_TIMEOUT_MS = 20 * 60_000;
setDefaultTimeout(STEP_TIMEOUT_MS);

export const lab = loadLab();
export const admin = new Admin(lab);

const spawners: Spawner[] = [];

/** A spawner of the lab, followed in the diagnostics of a failed step. */
export function spawnerOf(settings: SpawnerSettings): Spawner {
  const spawner = new Spawner(lab, settings);
  spawners.push(spawner);
  return spawner;
}

// A spawner that a failed step left running would hold its port and answer for
// the next suite's: whatever a suite did, none outlives it.
afterAll(async () => {
  await Promise.all(spawners.map((spawner) => spawner.kill()));
});

export function reportFor(suite: string): Report {
  return new Report(suite, reportDir(lab));
}

let counter = 0;
const run = randomUUID().replaceAll('-', '').slice(0, 8);

/** A session id no earlier run or suite used. */
export function sessionId(prefix: string): string {
  counter += 1;
  return `${prefix}-${run}-${counter}`;
}

export function pause(ms: number): Promise<void> {
  return Bun.sleep(ms);
}

/** Poll until `check` returns a value that is not undefined/false. */
export async function until<T>(
  what: string,
  check: () => Promise<T | undefined | false> | T | undefined | false,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = performance.now() + (options.timeoutMs ?? 60_000);
  let lastError: unknown;
  for (;;) {
    try {
      const value = await check();
      if (value !== undefined && value !== false) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (performance.now() > deadline) {
      throw new Error(
        `gave up waiting for ${what}${lastError === undefined ? '' : `: ${describeError(lastError)}`}`,
      );
    }
    await pause(options.intervalMs ?? 1_000);
  }
}

/** Throws, with what the spawner said, unless the reply has the status. */
export function expectStatus(reply: Reply, status: number, what: string): void {
  if (reply.status !== status) {
    throw new Error(
      `${what}: expected HTTP ${status}, got ${reply.status}: ${reply.text.slice(0, 600)}`,
    );
  }
}

/** The standbys on the node: pool instances nobody has claimed. */
export async function standbys(): Promise<AdminInstance[]> {
  return (await admin.instances()).filter(
    (instance) =>
      label(instance.config, LABEL.pool) !== undefined &&
      label(instance.config, LABEL.sandboxSession) !== '1',
  );
}

/** The standbys that wait for a claim, as the node shows them: running, with
 * the ready marker their script writes. */
export async function readyStandbys(): Promise<AdminInstance[]> {
  const waiting: AdminInstance[] = [];
  for (const standby of await standbys()) {
    if (standby.status !== 'Running') continue;
    const marker = await admin.exec(
      standby.name,
      ['test', '-f', '/run/tale-standby/ready'],
      { allowFailure: true },
    );
    if (marker.code === 0) waiting.push(standby);
  }
  return waiting;
}

/** The session's instance: by its deterministic name, or, when it was claimed
 * from the warm pool and so kept the standby's name, by its label. */
export async function sessionInstance(
  id: string,
): Promise<AdminInstance | undefined> {
  const named = await admin.instance(incusInstanceName(id));
  if (named !== undefined) return named;
  const all = await admin.instances();
  return all.find(
    (instance) =>
      label(instance.config, LABEL.session) === id &&
      label(instance.config, LABEL.sandboxSession) === '1',
  );
}

export async function sessionVolume(
  id: string,
): Promise<IncusVolume | undefined> {
  return admin.volume(incusWorkspaceVolumeName(id));
}

/** Run a shell command in the session through the spawner; stdout on success. */
export async function sh(
  api: SpawnerApi,
  id: string,
  shell: string,
  options: { env?: Record<string, string>; cwd?: string } = {},
): Promise<string> {
  const outcome = await api.exec(id, { shell, ...options });
  if (outcome.result?.status !== 'completed') {
    throw new Error(
      `\`${shell}\` in ${id} did not complete: HTTP ${outcome.reply.status} ${JSON.stringify(outcome.result ?? outcome.streamError ?? outcome.reply.text).slice(0, 600)}\nstdout: ${outcome.stdout.slice(0, 400)}\nstderr: ${outcome.stderr.slice(0, 400)}`,
    );
  }
  return outcome.stdout;
}

/** The last lines of a block of text. */
function tail(text: string, lines: number): string {
  return text.trim().split('\n').slice(-lines).join('\n');
}

/**
 * What the node can say about itself: its instances (with their consoles and
 * LXC logs), the DHCP leases of the sandbox bridge, the operations under way,
 * the volumes, and what the daemon logged lately. Read while a create is stuck
 * (a failed create removes what it made) and after a step failed.
 */
async function describeNode(): Promise<string[]> {
  const lines: string[] = [];
  const note = async (title: string, read: () => Promise<string>) => {
    try {
      lines.push(`-- ${title}:\n${await read()}`);
    } catch (error) {
      lines.push(`-- ${title}: unreadable (${describeError(error)})`);
    }
  };
  const instances = await admin.instances();
  for (const instance of instances) {
    lines.push(
      `-- instance ${instance.name}: ${instance.status}, ${instance.addresses.join(' ') || 'no address'}, session ${label(instance.config, LABEL.session) ?? '-'}`,
    );
  }
  // What each instance said on its console and in its LXC log: the end of it,
  // for the first few.
  for (const instance of instances.slice(0, 6)) {
    await note(`console of ${instance.name}`, async () =>
      tail(await admin.consoleLog(instance.name), 25),
    );
    await note(`LXC log of ${instance.name}`, async () =>
      tail(await admin.instanceLog(instance.name), 25),
    );
    // An OCI container has no DHCP client of its own: Incus runs one beside
    // it (`forknet dhcp`), and its log says why an instance has no address.
    await note(`DHCP client log of ${instance.name}`, async () =>
      tail(
        (
          await admin.host(
            [
              'cat',
              `/var/log/incus/${lab.project}_${instance.name}/forknet-dhcp.log`,
            ],
            { allowFailure: true },
          )
        ).stdout,
        30,
      ),
    );
  }
  await note('DHCP leases of the sandbox bridge', async () =>
    (
      await admin.run([
        'network',
        'list-leases',
        lab.network,
        '--project',
        lab.project,
      ])
    ).stdout.trim(),
  );
  await note('the lease file of the bridge', async () => {
    const leases = await admin.leases();
    return `${leases.length} lease(s); the last ten:\n${leases.slice(-10).join('\n')}`;
  });
  await note('operations of the project (with what failed them)', async () => {
    const raw: unknown = await admin.query(
      `/1.0/operations?recursion=1&project=${lab.project}`,
    );
    const found: string[] = [];
    if (typeof raw === 'object' && raw !== null) {
      for (const [status, list] of Object.entries(raw)) {
        if (!Array.isArray(list)) continue;
        for (const op of list) {
          found.push(
            `${status} ${asText(field(op, 'created_at')).slice(11, 23)} ${asText(field(op, 'description'))} ${asText(field(op, 'err'))} ${asText(field(op, 'resources')).slice(0, 160)}`,
          );
        }
      }
    }
    return found.toSorted().slice(-40).join('\n');
  });
  await note(
    'the Incus daemon, warnings and errors of the last three minutes',
    async () =>
      tail(
        (
          await admin.host(
            [
              'journalctl',
              '-u',
              'incus',
              '-p',
              'warning',
              '--no-pager',
              '--since',
              '3 minutes ago',
            ],
            { allowFailure: true },
          )
        ).stdout
          .split('\n')
          .filter((line) => !line.includes('Failed to close connection'))
          .join('\n'),
        60,
      ),
  );
  for (const volume of await admin.volumes()) {
    lines.push(`-- volume ${volume.name}: ${JSON.stringify(volume.config)}`);
  }
  return lines;
}

async function dumpState(why: string): Promise<void> {
  const lines = [`\n==== the lab after a failed step: ${why}`];
  for (const spawner of spawners) {
    lines.push(
      `-- spawner ${spawner.settings.name} (${spawner.running ? 'running' : 'not running'}), the end of its log:`,
      spawner.logTail(80),
    );
  }
  try {
    lines.push(...(await describeNode()));
  } catch (error) {
    lines.push(`(the node could not be read: ${describeError(error)})`);
  }
  console.error(lines.join('\n'));
}

// A create that has not answered in this long is looked at while it is stuck:
// when it fails, the instance it made is gone, and so is the evidence.
watchSlowCreates(async (creating, elapsedMs) => {
  const lines = [
    `\n==== a create of ${creating} has not answered after ${Math.round(elapsedMs / 1000)} s`,
  ];
  try {
    lines.push(...(await describeNode()));
  } catch (error) {
    lines.push(`(the node could not be read: ${describeError(error)})`);
  }
  console.error(lines.join('\n'));
});

/** A test that, when it fails, first says what the lab looked like. */
export function step(
  name: string,
  fn: () => Promise<void>,
  timeoutMs: number = STEP_TIMEOUT_MS,
): void {
  test(
    name,
    async () => {
      try {
        await fn();
      } catch (error) {
        await dumpState(name);
        throw error;
      }
    },
    timeoutMs,
  );
}
