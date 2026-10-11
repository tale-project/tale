// What every suite shares: the lab, the administrator, a way to start spawners
// and to find a session's objects on the node, and a `step` that says what the
// node and the spawners looked like when a step failed.

import { setDefaultTimeout, test } from 'bun:test';
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
import type { Reply, SpawnerApi } from './spawner-api.ts';
import { Spawner, type SpawnerSettings } from './spawner.ts';
import { describeError } from './util.ts';

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

async function dumpState(why: string): Promise<void> {
  const lines = [`\n==== the lab after a failed step: ${why}`];
  for (const spawner of spawners) {
    lines.push(
      `-- spawner ${spawner.settings.name} (${spawner.running ? 'running' : 'not running'}), the end of its log:`,
      spawner.logTail(80),
    );
  }
  try {
    for (const instance of await admin.instances()) {
      lines.push(
        `-- instance ${instance.name}: ${instance.status}, ${instance.addresses.join(' ') || 'no address'}, session ${label(instance.config, LABEL.session) ?? '-'}`,
      );
    }
    for (const volume of await admin.volumes()) {
      lines.push(`-- volume ${volume.name}: ${JSON.stringify(volume.config)}`);
    }
  } catch (error) {
    lines.push(`(the node could not be read: ${describeError(error)})`);
  }
  console.error(lines.join('\n'));
}

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
