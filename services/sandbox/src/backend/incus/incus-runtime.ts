// What the Incus host backend and the Incus session backend share: one API
// client (one set of certificates read once), one warm pool, and the ids of
// the creates under way. The two backends are made separately by the backend
// loader, so they meet here, keyed by the spawner's config.

import { randomUUID } from 'node:crypto';

import type { IncusConfig, SpawnerConfig } from '../../types.ts';
import { IncusClient } from './incus-client.ts';
import { IncusPool } from './incus-pool.ts';
import { incusOf } from './incus-session-spec.ts';
import { readIncusTlsMaterial } from './incus-tls.ts';

export interface IncusRuntimeDeps {
  /** A client to use instead of one built from the certificate files. */
  client?: IncusClient;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Hex for a standby's name. */
  randomId?: () => string;
  /** The random id of one create attempt. */
  attemptId?: () => string;
}

export interface IncusConnection {
  client: IncusClient;
  pool: IncusPool;
}

export class IncusRuntime {
  readonly incus: IncusConfig;
  /** Ids of the sessions whose create is under way here: a create counts
   * against the capacity before the instance listing shows it. */
  readonly inFlight = new Set<string>();
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly attemptId: () => string;
  private connecting: Promise<IncusConnection> | undefined;
  private driver: Promise<string> | undefined;

  constructor(
    readonly cfg: SpawnerConfig,
    private readonly deps: IncusRuntimeDeps = {},
  ) {
    this.incus = incusOf(cfg);
    this.now = deps.now ?? Date.now;
    this.sleep =
      deps.sleep ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.attemptId = deps.attemptId ?? randomUUID;
  }

  /** The client and the pool, made on first use. The certificate files are
   * read (and refused, in words, when they cannot work) here, so the host
   * backend's init is where a bad setup first speaks. */
  connect(): Promise<IncusConnection> {
    this.connecting ??= this.open().catch((error: unknown) => {
      // A fixed file is read again by the next try.
      this.connecting = undefined;
      throw error;
    });
    return this.connecting;
  }

  private async open(): Promise<IncusConnection> {
    const client =
      this.deps.client ??
      new IncusClient({
        endpoint: this.incus.endpoint,
        project: this.incus.project,
        tls: await readIncusTlsMaterial(this.incus),
        requestTimeoutMs: this.incus.apiTimeoutMs,
      });
    const pool = new IncusPool(this.cfg, client, {
      now: this.now,
      sleep: this.sleep,
      ...(this.deps.randomId === undefined
        ? {}
        : { randomId: this.deps.randomId }),
      inFlight: () => this.inFlight,
    });
    return { client, pool };
  }

  /** The driver of the storage pool the workspaces live on (`zfs`, ...). */
  storageDriver(): Promise<string> {
    this.driver ??= this.connect()
      .then(({ client }) => client.getStoragePool(this.incus.storagePool))
      .then((pool) => pool.driver)
      .catch((error: unknown) => {
        this.driver = undefined;
        throw error;
      });
    return this.driver;
  }
}

const runtimes = new WeakMap<SpawnerConfig, IncusRuntime>();

/** The runtime of this spawner config; the same one for every caller. */
export function getIncusRuntime(cfg: SpawnerConfig): IncusRuntime {
  let runtime = runtimes.get(cfg);
  if (runtime === undefined) {
    runtime = new IncusRuntime(cfg);
    runtimes.set(cfg, runtime);
  }
  return runtime;
}
