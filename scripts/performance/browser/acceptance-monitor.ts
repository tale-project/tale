import assert from 'node:assert/strict';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Single host writer, atomic replacement: readers never see a partial JSON
 * checkpoint. An existing temporary file refuses rather than overwriting it. */
export async function publishResourceCheckpoint(
  directory: string,
  value: unknown,
) {
  const next = join(directory, 'resource-live.next');
  await writeFile(next, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  await rename(next, join(directory, 'resource-live.json'));
}

export async function acknowledgeMonitorStop(directory: string, token: string) {
  let value: string;
  try {
    value = await readFile(join(directory, 'resource-monitor-stop'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  assert.equal(value, token, 'Unowned monitor stop request');
  await writeFile(join(directory, 'resource-monitor-stopped'), token, {
    flag: 'wx',
    mode: 0o600,
  });
  return true;
}

/** The runner ends all actions before this handshake. The host finishes its
 * active checkpoint and stops before the coordinator tears down containers. */
export async function stopResourceMonitor(
  directory: string,
  io = {
    now: Date.now,
    wait: (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms)),
  },
) {
  const token = await readFile(join(directory, 'resource-token'), 'utf8');
  assert.match(token, /^[a-f0-9]{32}$/);
  await writeFile(join(directory, 'resource-monitor-stop'), token, {
    flag: 'wx',
    mode: 0o600,
  });
  const end = io.now() + 10_000;
  while (io.now() < end) {
    try {
      assert.equal(
        await readFile(join(directory, 'resource-monitor-stopped'), 'utf8'),
        token,
        'Unowned monitor stop acknowledgment',
      );
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await io.wait(Math.min(100, end - io.now()));
  }
  throw new Error('Resource monitor did not acknowledge stop within10s');
}
