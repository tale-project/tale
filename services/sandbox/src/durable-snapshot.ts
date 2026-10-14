// One commit boundary for spawner-owned JSON state. Rename commits the new
// snapshot before directory fsync: callers must publish that committed state
// in memory even if the final flush fails, or their next write could erase it.
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function writeDurableSnapshot(
  file: string,
  contents: string,
  committed: () => void,
  flushDirectory: () => Promise<void> = () => flushSnapshotDirectory(file),
): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, file);
    committed();
    await flushDirectory();
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function flushSnapshotDirectory(file: string): Promise<void> {
  const directory = await open(dirname(file), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
