// IncusBackend — the Incus host lifecycle. Every sandbox run is a session
// (incus-session-backend.ts), so this backend executes nothing: it owns the
// spawner's host-level lifecycle — checking at boot that the Incus project,
// profile, network and storage pool are what the backend needs, the warm
// pool's upkeep, the /health probe, getting the runtime image into the
// project, and the periodic sweep of debris.

import { belongsToInstance } from '../../session/session-naming.ts';
import type { SpawnerConfig } from '../../types.ts';
import type { HealthResult, HostBackend } from '../types.ts';
import { incusStatus } from './incus-api.ts';
import { inspectIncus } from './incus-checks.ts';
import type { IncusClient } from './incus-client.ts';
import {
  hasEnded,
  STARTUP_SLACK_MS,
  startupExpired,
} from './incus-lifecycle.ts';
import {
  incusWarmupInstanceName,
  isScratchVolume,
  isSessionInstance,
  isWarmupInstanceName,
  label,
  LABEL,
} from './incus-naming.ts';
import { describeRegistryCaches } from './incus-registry-caches.ts';
import { removeIncusInstance } from './incus-remove.ts';
import { getIncusRuntime, type IncusRuntime } from './incus-runtime.ts';
import { buildWarmupInstance } from './incus-session-spec.ts';

/** A runtime image is several GiB: a pull waits this long. */
const PULL_WAIT_MS = 20 * 60_000;
const WARMUP_WAIT_MS = 5 * 60_000;

export interface IncusBackendDeps {
  /** Shared with the session backend; defaults to the config's own. */
  runtime?: IncusRuntime;
}

/** Wraps a read of the node so a failure says which setting to look at. */
async function read<T>(what: string, hint: string, fetch: () => Promise<T>) {
  try {
    return await fetch();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read ${what}: ${message} (${hint})`, {
      cause: error,
    });
  }
}

export class IncusBackend implements HostBackend {
  readonly kind = 'incus' as const;
  private readonly runtime: IncusRuntime;
  /** Image fingerprints already unpacked into the pool by this process. */
  private readonly prepared = new Set<string>();

  constructor(
    private readonly cfg: SpawnerConfig,
    deps: IncusBackendDeps = {},
  ) {
    this.runtime = deps.runtime ?? getIncusRuntime(cfg);
  }

  async init(): Promise<void> {
    const incus = this.runtime.incus;
    // The certificate files are read and checked here; a setup that cannot
    // work speaks in words, once, at boot.
    const { client, pool } = await this.runtime.connect();
    const server = await read(
      `the Incus server at ${incus.endpoint}`,
      'check SANDBOX_INCUS_ENDPOINT, the pinned server certificate and that the node is reachable',
      () => client.getServer(),
    );
    if (server.auth !== 'trusted') {
      throw new Error(
        `the Incus server at ${incus.endpoint} does not trust this client certificate (auth: ${server.auth || 'unknown'}). Add it, restricted to the sandbox project: incus config trust add-certificate <client.crt> --restricted --projects ${incus.project}`,
      );
    }
    const [project, profile, network, storagePool] = await Promise.all([
      read(
        `Incus project ${incus.project}`,
        'SANDBOX_INCUS_PROJECT must be a project the certificate is restricted to',
        () => client.getProject(),
      ),
      read(`Incus profile ${incus.profile}`, 'SANDBOX_INCUS_PROFILE', () =>
        client.getProfile(incus.profile),
      ),
      read(`Incus network ${incus.network}`, 'SANDBOX_INCUS_NETWORK', () =>
        client.getNetwork(incus.network),
      ),
      read(
        `Incus storage pool ${incus.storagePool}`,
        'SANDBOX_INCUS_STORAGE_POOL',
        () => client.getStoragePool(incus.storagePool),
      ),
    ]);
    const findings = inspectIncus(this.cfg, {
      server,
      project,
      profile,
      network,
      pool: storagePool,
    });
    for (const warning of findings.warnings) {
      console.warn(`[sandbox.incus] ${warning}`);
    }
    if (findings.errors.length > 0) {
      throw new Error(
        `the Incus backend cannot run on ${incus.endpoint}:\n- ${findings.errors.join('\n- ')}`,
      );
    }
    console.log(
      `[sandbox.incus] Incus ${server.serverVersion || '(unknown version)'} at ${incus.endpoint}: project=${incus.project} profile=${incus.profile} network=${incus.network} pool=${incus.storagePool} (${storagePool.driver}) image=${incus.image} warmPool=${incus.poolSize}`,
    );
    if (incus.registryCaches !== undefined) {
      console.log(
        `[sandbox.incus] ${describeRegistryCaches(incus.registryCaches)}`,
      );
    }
    pool.start();
  }

  async shutdown(): Promise<void> {
    this.runtime.stopPool();
  }

  /** A draining spawner leaves the warm pool to its replacement: two spawners
   * each filling the pool to its target would pass the session capacity
   * between them. Creates this spawner already admitted still claim from it. */
  beginDrain(): void {
    this.runtime.stopPool();
  }

  async health(): Promise<HealthResult> {
    try {
      const { client, pool } = await this.runtime.connect();
      const server = await client.getServer();
      if (server.auth !== 'trusted') {
        return {
          ok: false,
          error: `the Incus server does not trust this client certificate (auth: ${server.auth || 'unknown'})`,
        };
      }
      const { project, poolSize } = this.runtime.incus;
      return {
        ok: true,
        detail: `incus ${server.serverVersion} project=${project}${poolSize > 0 ? ` warm=${pool.readyCount()}/${poolSize}` : ''}`,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Make the runtime image an alias of the project: pulled from the OCI
   * registry the spawner was given, when it is not there yet. Then have Incus
   * unpack it into the storage pool, which it otherwise does while the first
   * session starts. Throws while the image stays absent, so the warm-up keeps
   * creates waiting and tries again.
   */
  async warmImage(): Promise<void> {
    const { client } = await this.runtime.connect();
    const { image, imageSource, project } = this.runtime.incus;
    let alias = await client.getImageAlias(image);
    if (alias === undefined) {
      if (imageSource === undefined) {
        throw new Error(
          `the runtime image ${image} is not in Incus project ${project}, and SANDBOX_INCUS_IMAGE_SOURCE names no registry to pull it from. Import it as an administrator (incus image copy ... --alias ${image} --project ${project}) or set the source`,
        );
      }
      console.log(
        `[sandbox.incus] pulling ${imageSource.alias} from ${imageSource.server} as ${image}`,
      );
      await client.pullOciImage(imageSource, image, PULL_WAIT_MS);
      alias = await client.getImageAlias(image);
      if (alias === undefined) {
        throw new Error(
          `the pull of ${imageSource.alias} finished, but ${image} is still not an image alias of project ${project}`,
        );
      }
    }
    await this.unpack(client, alias.target);
  }

  /** A throwaway stopped instance makes Incus unpack the image into the pool
   * now. Best effort: without it the first session start pays for it. */
  private async unpack(
    client: IncusClient,
    fingerprint: string,
  ): Promise<void> {
    if (this.prepared.has(fingerprint)) return;
    const name = incusWarmupInstanceName(
      this.runtime.attemptId().replaceAll('-', '').slice(0, 12),
    );
    try {
      await client.createInstance(
        buildWarmupInstance(this.cfg, name),
        WARMUP_WAIT_MS,
      );
      this.prepared.add(fingerprint);
    } catch (error) {
      console.warn(
        `[sandbox.incus] unpacking the runtime image ahead of the first session failed (the first session start unpacks it):`,
        error instanceof Error ? error.message : error,
      );
    }
    try {
      await removeIncusInstance(client, name, { sleep: this.runtime.sleep });
    } catch (error) {
      console.warn(
        `[sandbox.incus] removing the warm-up instance ${name} failed (the sweep takes it later):`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Debris, not sessions (those are the session reaper's): an instance of this
   * spawner that ended and was never reaped, a crashed warm-up's instance, and
   * the scratch volume of a render session whose instance is gone. A
   * workspace of an agent session is never touched here — the platform
   * destroys those from its records.
   */
  async sweepOrphans(): Promise<number> {
    const { client } = await this.runtime.connect();
    const nowMs = this.runtime.now();
    const { createHealthTimeoutMs } = this.cfg.session;
    let removed = 0;

    const instances = await client.listInstances();
    const sessionIds = new Set<string>(this.runtime.inFlight);
    for (const instance of instances) {
      if (isWarmupInstanceName(instance.name)) {
        // A peer spawner's warm-up under way is not debris: its create waits
        // for the unpack up to WARMUP_WAIT_MS, and removing it from under
        // that wait only costs the peer its head start on the image.
        const born = Date.parse(instance.createdAt);
        if (
          Number.isFinite(born) &&
          nowMs - born < WARMUP_WAIT_MS + STARTUP_SLACK_MS
        ) {
          continue;
        }
        if (
          await this.removeDebris(client, instance.name, 'warm-up instance')
        ) {
          removed += 1;
        }
        continue;
      }
      if (!isSessionInstance(instance.config, this.cfg.instance)) continue;
      if (
        hasEnded(instance) &&
        startupExpired(instance, nowMs, createHealthTimeoutMs)
      ) {
        if (await this.removeDebris(client, instance.name, 'ended session')) {
          removed += 1;
          continue;
        }
      }
      const id = label(instance.config, LABEL.session);
      if (id !== undefined) sessionIds.add(id);
    }

    const { storagePool } = this.runtime.incus;
    for (const volume of await client.listVolumes(storagePool)) {
      if (label(volume.config, LABEL.workspace) !== '1') continue;
      if (
        !belongsToInstance(
          label(volume.config, LABEL.spawnerInstance),
          this.cfg.instance,
        )
      ) {
        continue;
      }
      // Only a volume that records itself as a render's scratch: an agent
      // session's workspace is the platform's to destroy, and a volume that
      // says nothing is never taken for scratch.
      if (!isScratchVolume(volume.config)) continue;
      const id = label(volume.config, LABEL.session);
      if (id === undefined || sessionIds.has(id) || volume.usedBy.length > 0) {
        continue;
      }
      // A create makes the scratch before its instance: only one older than a
      // whole create's budget is an orphan.
      if (
        volume.createdAtMs === 0 ||
        nowMs - volume.createdAtMs < createHealthTimeoutMs + STARTUP_SLACK_MS
      ) {
        continue;
      }
      try {
        if (await client.deleteVolume(storagePool, volume.name)) {
          console.warn(
            `[sandbox.incus] removed the orphaned scratch volume ${volume.name}`,
          );
          removed += 1;
        }
      } catch (error) {
        if (incusStatus(error) !== 404) {
          console.warn(
            `[sandbox.incus] removing the scratch volume ${volume.name} failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
    return removed;
  }

  private async removeDebris(
    client: IncusClient,
    name: string,
    what: string,
  ): Promise<boolean> {
    try {
      const removal = await removeIncusInstance(client, name, {
        sleep: this.runtime.sleep,
      });
      if (removal === 'removed') {
        console.warn(`[sandbox.incus] removed the ${what} ${name}`);
        return true;
      }
    } catch (error) {
      console.warn(
        `[sandbox.incus] removing the ${what} ${name} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
    return false;
  }
}
