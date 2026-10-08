// Which device a session lives on — the hub's durable memory of placement.
//
// A session's workspace lives on the machine that created it, so once the hub
// sends a session to a device every later call for that session id must go
// there too, including after a hub restart and while the device is offline:
// answering such a call from the local backend would read as "session gone"
// (a 404), and the platform marks a gone session destroyed. The store is one
// small JSON file on the spawner's persistent volume, rewritten atomically
// (temp file + rename) on every change and read once at boot.
//
// A session absent from the store lives on the server, which is also what
// every session created before devices existed is.

import { readFile } from 'node:fs/promises';

import {
  flushSnapshotDirectory,
  writeDurableSnapshot,
} from '../durable-snapshot.ts';
import { ID_ALPHABET_RE, ORG_ID_ALPHABET_RE } from '../wire.ts';

export interface Placement {
  deviceId: string;
  organizationId: string;
  placedAtMs: number;
  /** The session was destroyed, and its device has not confirmed that the
   * workspace's bytes are gone: no session lives there any more, but the
   * destroy that asks again must still reach the device that holds them. */
  deleting?: true;
}

interface PlacementFile {
  version: 1;
  placements: Record<string, Placement>;
}

function isPlacement(value: unknown): value is Placement {
  if (value === null || typeof value !== 'object') return false;
  const deviceId: unknown = Reflect.get(value, 'deviceId');
  const organizationId: unknown = Reflect.get(value, 'organizationId');
  const placedAtMs: unknown = Reflect.get(value, 'placedAtMs');
  const deleting: unknown = Reflect.get(value, 'deleting');
  return (
    typeof deviceId === 'string' &&
    ID_ALPHABET_RE.test(deviceId) &&
    typeof organizationId === 'string' &&
    ORG_ID_ALPHABET_RE.test(organizationId) &&
    typeof placedAtMs === 'number' &&
    Number.isFinite(placedAtMs) &&
    placedAtMs >= 0 &&
    (deleting === undefined || deleting === true)
  );
}

export class PlacementStore {
  private placements = new Map<string, Placement>();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  /** A missing file is a new store. An invalid existing snapshot refuses
   * startup and stays untouched: forgetting a route would misreport an
   * existing remote workspace as gone and create a second copy elsewhere. */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (err) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'ENOENT'
      ) {
        return;
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Invalid device placement snapshot at ${this.file}`, {
        cause: err,
      });
    }
    const placements: unknown =
      parsed !== null && typeof parsed === 'object'
        ? Reflect.get(parsed, 'placements')
        : undefined;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Reflect.get(parsed, 'version') !== 1 ||
      placements === null ||
      typeof placements !== 'object' ||
      Array.isArray(placements)
    )
      throw new Error(`Invalid device placement snapshot at ${this.file}`);
    const loaded = new Map<string, Placement>();
    for (const [sessionId, placement] of Object.entries(placements)) {
      if (!ID_ALPHABET_RE.test(sessionId) || !isPlacement(placement))
        throw new Error(`Invalid device placement snapshot at ${this.file}`);
      loaded.set(sessionId, placement);
    }
    this.placements = loaded;
  }

  get(sessionId: string): Placement | undefined {
    return this.placements.get(sessionId);
  }

  /** Every session placed on devices of one organization — not a destroyed
   * one whose bytes a device is still deleting. */
  forOrganization(
    organizationId: string,
  ): Array<{ sessionId: string; deviceId: string }> {
    const out: Array<{ sessionId: string; deviceId: string }> = [];
    for (const [sessionId, p] of this.placements) {
      if (p.organizationId === organizationId && p.deleting !== true) {
        out.push({ sessionId, deviceId: p.deviceId });
      }
    }
    return out;
  }

  async set(sessionId: string, placement: Placement): Promise<void> {
    if (!ID_ALPHABET_RE.test(sessionId) || !isPlacement(placement))
      throw new Error('Invalid device placement');
    await this.change((next) => {
      next.set(sessionId, placement);
    });
  }

  /** The destroyed sessions whose bytes their devices have not confirmed
   * gone. */
  deleting(): Array<{ sessionId: string; deviceId: string }> {
    const out: Array<{ sessionId: string; deviceId: string }> = [];
    for (const [sessionId, p] of this.placements) {
      if (p.deleting === true) out.push({ sessionId, deviceId: p.deviceId });
    }
    return out;
  }

  /** Keep a destroyed session's route to its device until the device
   * confirms the workspace's bytes are gone. */
  async markDeleting(sessionId: string): Promise<void> {
    await this.change((next) => {
      const placement = next.get(sessionId);
      if (placement === undefined || placement.deleting === true) return;
      next.set(sessionId, { ...placement, deleting: true });
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.change((next) => {
      next.delete(sessionId);
    });
  }

  /** Forget every placement on a device (it was removed); the count dropped. */
  async deleteDevice(deviceId: string): Promise<number> {
    return this.change((next) => {
      let dropped = 0;
      for (const [sessionId, p] of next) {
        if (p.deviceId === deviceId) {
          next.delete(sessionId);
          dropped++;
        }
      }
      return dropped;
    });
  }

  /** Serialize the whole mutation, not only its write. The atomic rename is
   * the commit point: directory flush failures must not roll memory back to
   * a snapshot that could erase the committed route on the next mutation. */
  private change<T>(mutate: (next: Map<string, Placement>) => T): Promise<T> {
    const next = this.writing.then(async () => {
      const snapshot = new Map(this.placements);
      const result = mutate(snapshot);
      if (
        snapshot.size !== this.placements.size ||
        [...snapshot].some(([id, p]) => this.placements.get(id) !== p)
      ) {
        await this.writeSnapshot(snapshot);
      }
      return result;
    });
    // A failed write must not wedge every later one behind a rejection.
    this.writing = next
      .then(() => undefined)
      .catch((err: unknown) => {
        console.error('[sandbox.devices] placement write failed:', err);
      });
    return next;
  }

  private async writeSnapshot(
    placements: ReadonlyMap<string, Placement>,
  ): Promise<void> {
    const snapshot: PlacementFile = {
      version: 1,
      placements: Object.fromEntries(placements),
    };
    await writeDurableSnapshot(
      this.file,
      JSON.stringify(snapshot),
      () => {
        this.placements = new Map(placements);
      },
      () => this.flushDirectory(),
    );
  }

  private flushDirectory(): Promise<void> {
    return flushSnapshotDirectory(this.file);
  }
}
