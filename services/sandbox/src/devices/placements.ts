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

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Placement {
  deviceId: string;
  organizationId: string;
  placedAtMs: number;
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
  return (
    typeof deviceId === 'string' &&
    typeof organizationId === 'string' &&
    typeof placedAtMs === 'number'
  );
}

export class PlacementStore {
  private readonly placements = new Map<string, Placement>();
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  /** Read the file. A missing file is an empty store; an unreadable one is
   * moved aside (kept for an operator) and the hub starts empty — those
   * sessions' next calls reach the local backend, which answers "gone", and
   * the platform starts them afresh. */
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
      const aside = `${this.file}.corrupt-${Date.now()}`;
      console.error(
        `[sandbox.devices] placement file ${this.file} is not JSON; moved to ${aside} and starting empty:`,
        err,
      );
      await rename(this.file, aside);
      return;
    }
    const placements: unknown =
      parsed !== null && typeof parsed === 'object'
        ? Reflect.get(parsed, 'placements')
        : undefined;
    if (placements === null || typeof placements !== 'object') return;
    for (const [sessionId, placement] of Object.entries(placements)) {
      if (isPlacement(placement)) this.placements.set(sessionId, placement);
    }
  }

  get(sessionId: string): Placement | undefined {
    return this.placements.get(sessionId);
  }

  /** Every session placed on devices of one organization. */
  forOrganization(
    organizationId: string,
  ): Array<{ sessionId: string; deviceId: string }> {
    const out: Array<{ sessionId: string; deviceId: string }> = [];
    for (const [sessionId, p] of this.placements) {
      if (p.organizationId === organizationId) {
        out.push({ sessionId, deviceId: p.deviceId });
      }
    }
    return out;
  }

  async set(sessionId: string, placement: Placement): Promise<void> {
    this.placements.set(sessionId, placement);
    await this.persist();
  }

  async delete(sessionId: string): Promise<void> {
    if (!this.placements.delete(sessionId)) return;
    await this.persist();
  }

  /** Forget every placement on a device (it was removed); the count dropped. */
  async deleteDevice(deviceId: string): Promise<number> {
    let dropped = 0;
    for (const [sessionId, p] of this.placements) {
      if (p.deviceId === deviceId) {
        this.placements.delete(sessionId);
        dropped++;
      }
    }
    if (dropped > 0) await this.persist();
    return dropped;
  }

  /** Serialized so two changes never interleave their temp-file renames; the
   * written snapshot is taken when the write runs, so it is always current. */
  private persist(): Promise<void> {
    const next = this.writing.then(() => this.writeSnapshot());
    // A failed write must not wedge every later one behind a rejection.
    this.writing = next.catch((err: unknown) => {
      console.error('[sandbox.devices] placement write failed:', err);
    });
    return next;
  }

  private async writeSnapshot(): Promise<void> {
    const snapshot: PlacementFile = {
      version: 1,
      placements: Object.fromEntries(this.placements),
    };
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(snapshot), { mode: 0o600 });
    await rename(tmp, this.file);
  }
}
