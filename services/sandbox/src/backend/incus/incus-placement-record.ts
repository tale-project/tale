// The durable record of which Incus host each session lives on, for a spawner
// with several hosts (SANDBOX_INCUS_ENDPOINTS). A session's workspace volume
// is on one host, so once the spawner has placed it there, it may only ever be
// resumed there: started on another host it would come back with an empty
// workspace, and two workspaces of one id would exist once the first host
// returns. The record survives a restart of the spawner because it lives in a
// file on the spawner's own data volume (SANDBOX_INCUS_STATE_DIR), written
// whole and atomically (a temporary file, synced, renamed over the old one).
//
// The record is `complete` once every declared host has been listed at least
// once since it was first made. A spawner that starts without a record (the
// first start with it, or a record that could not be read) rebuilds it from
// every host's listings; `listed` names the hosts already listed, so a
// restart in the middle of that goes on where it stopped.

import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** The file of the record, in SANDBOX_INCUS_STATE_DIR. */
export const PLACEMENT_RECORD_FILE = 'placement.json';

export interface PlacementRecord {
  /** Every declared host has been listed once since the record was made. */
  complete: boolean;
  /** The hosts listed so far, while the record is not complete. */
  listed: readonly string[];
  /** Session id → the name of the host it lives on. */
  sessions: Readonly<Record<string, string>>;
}

/** Where the record is kept. */
export interface PlacementStore {
  /** The record, or undefined when there is none yet (or it could not be
   * read, which is logged): the caller rebuilds it. */
  load(): Promise<PlacementRecord | undefined>;
  /** Replaces the record; resolves once it is durable. */
  save(record: PlacementRecord): Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The record a file holds, or a thrown error that says what is wrong. */
export function parsePlacementRecord(text: string): PlacementRecord {
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || parsed.version !== 1) {
    throw new Error('not a version 1 placement record');
  }
  const { complete, listed, sessions } = parsed;
  if (typeof complete !== 'boolean') {
    throw new Error('complete is not true or false');
  }
  if (
    !Array.isArray(listed) ||
    !listed.every((name): name is string => typeof name === 'string')
  ) {
    throw new Error('listed is not a list of host names');
  }
  if (!isObject(sessions)) {
    throw new Error('sessions does not map session ids to host names');
  }
  const hosts: Record<string, string> = {};
  for (const [sessionId, name] of Object.entries(sessions)) {
    if (typeof name !== 'string') {
      throw new Error(`session ${sessionId} names no host`);
    }
    hosts[sessionId] = name;
  }
  return { complete, listed, sessions: hosts };
}

/** The record in a file of its own directory. */
export class FilePlacementStore implements PlacementStore {
  readonly file: string;

  constructor(directory: string) {
    this.file = join(directory, PLACEMENT_RECORD_FILE);
  }

  async load(): Promise<PlacementRecord | undefined> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return undefined;
      }
      throw error;
    }
    try {
      return parsePlacementRecord(text);
    } catch (error) {
      // Kept aside for a person to look at; the record is rebuilt from the
      // hosts' listings, as on a first start.
      const aside = `${this.file}.unreadable-${Date.now()}`;
      await rename(this.file, aside);
      console.error(
        `[sandbox.incus] the placement record ${this.file} could not be read (${error instanceof Error ? error.message : String(error)}); it is kept as ${aside} and rebuilt from the hosts' listings`,
      );
      return undefined;
    }
  }

  async save(record: PlacementRecord): Promise<void> {
    const directory = dirname(this.file);
    await mkdir(directory, { recursive: true });
    const temporary = `${this.file}.tmp`;
    const handle = await open(temporary, 'w', 0o600);
    try {
      await handle.writeFile(
        `${JSON.stringify({ version: 1, ...record })}\n`,
        'utf8',
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.file);
    // The rename itself is durable once the directory is synced.
    const dir = await open(directory, 'r');
    try {
      await dir.sync();
    } finally {
      await dir.close();
    }
  }
}

/** The record in memory, for tests: what a restart of the spawner would read
 * back, and a seam to make a write fail. */
export class MemoryPlacementStore implements PlacementStore {
  saved: PlacementRecord | undefined;
  saves = 0;
  /** While set, every save fails with it. */
  failure: Error | undefined;

  constructor(initial?: PlacementRecord) {
    this.saved = initial;
  }

  async load(): Promise<PlacementRecord | undefined> {
    return this.saved === undefined ? undefined : structuredClone(this.saved);
  }

  async save(record: PlacementRecord): Promise<void> {
    if (this.failure !== undefined) throw this.failure;
    this.saves += 1;
    this.saved = structuredClone(record);
  }
}
