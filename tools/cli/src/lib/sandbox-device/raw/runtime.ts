import {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  RAW_RUNTIME_DIGEST,
  RAW_RUNTIME_FILES,
} from '../../../generated/raw-runtime';

/**
 * The raw device's runtime laid out under its root: the spawner and runnerd
 * bundles and the image's helper programs (scripts/generate-raw-runtime.ts),
 * one directory per release and build — `lib/<release>-<digest>/` — readable
 * and runnable by every slot account, written by the device alone.
 *
 * The directory a device lays out stays while a session may run from it: a
 * runnerd loads its lazy chunks from the directory it started in, so an
 * update leaves the last few in place.
 */
export interface RawRuntime {
  dir: string;
  /** The spawner bundle `tale sandbox device run` imports. */
  spawner: string;
  /** runnerd's bundle, one process per session. */
  runnerd: string;
  /** The helper programs, first on every session's PATH. */
  bin: string;
  /** Claude Code's settings a session starts with. */
  claudeSettings: string;
}

/** How many laid-out runtimes a device keeps. */
const KEEP_RUNTIMES = 3;
const COMPLETE = '.complete';

export function runtimeDirName(version: string): string {
  const release = /^[0-9A-Za-z.+-]{1,64}$/.test(version) ? version : 'dev';
  return `${release}-${RAW_RUNTIME_DIGEST.slice(0, 12)}`;
}

/** Claude Code's managed settings of the image, with its hooks pointing at
 * the device's copies of the helper programs. */
export function claudeSettingsFor(managed: string, bin: string): string {
  return managed.replaceAll('/usr/local/bin/tale-', `${bin}/tale-`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Lay out this CLI's runtime under `root/lib` (once per build), keep the
 * newest few, and say where its parts are. */
export async function layOutRawRuntime(
  root: string,
  version: string,
): Promise<RawRuntime> {
  const lib = join(root, 'lib');
  const dir = join(lib, runtimeDirName(version));
  const runtime: RawRuntime = {
    dir,
    spawner: join(dir, 'lib', 'sandbox-device.mjs'),
    runnerd: join(dir, 'lib', 'runnerd.mjs'),
    bin: join(dir, 'bin'),
    claudeSettings: join(dir, 'claude-settings.json'),
  };
  if (
    (await exists(join(dir, COMPLETE))) &&
    (await readFile(join(dir, COMPLETE), 'utf8')).trim() === RAW_RUNTIME_DIGEST
  ) {
    return runtime;
  }
  await mkdir(lib, { recursive: true, mode: 0o755 });
  await chmod(lib, 0o755);
  // Laid out beside its place and renamed in, so a runtime is never half
  // there for a session that starts while it is written.
  const staging = `${dir}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  for (const [name, content] of Object.entries(RAW_RUNTIME_FILES)) {
    const path = join(staging, name);
    await mkdir(dirname(path), { recursive: true, mode: 0o755 });
    await writeFile(path, content, {
      mode: name.startsWith('bin/') ? 0o755 : 0o644,
    });
  }
  const managed = RAW_RUNTIME_FILES['claude-managed-settings.json'];
  if (managed === undefined) {
    throw new Error('this CLI carries no Claude Code settings for raw devices');
  }
  await writeFile(
    join(staging, 'claude-settings.json'),
    claudeSettingsFor(managed, runtime.bin),
    { mode: 0o644 },
  );
  await writeFile(join(staging, COMPLETE), `${RAW_RUNTIME_DIGEST}\n`, {
    mode: 0o644,
  });
  await chmod(staging, 0o755);
  await rm(dir, { recursive: true, force: true });
  await rename(staging, dir);
  await pruneRuntimes(lib, dir);
  return runtime;
}

async function pruneRuntimes(lib: string, current: string): Promise<void> {
  const entries: Array<{ path: string; mtimeMs: number }> = [];
  for (const name of await readdir(lib)) {
    const path = join(lib, name);
    if (path === current) continue;
    try {
      const info = await stat(path);
      if (info.isDirectory()) entries.push({ path, mtimeMs: info.mtimeMs });
    } catch (err) {
      console.warn(`[tale] cannot read ${path}:`, err);
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const old of entries.slice(KEEP_RUNTIMES - 1)) {
    await rm(old.path, { recursive: true, force: true });
  }
}
