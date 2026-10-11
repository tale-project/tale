// IncusSessionBackend — persistent sessions on the Incus path.
//
// Sibling of the Docker and Kubernetes session backends. One ephemeral OCI
// container per session (incus-session-spec.ts) running runnerd; the spawner
// reaches runnerd at the container's address on :8200 over plain HTTP,
// exec-free. The workspace is a quota'd custom volume that outlives the
// container: stopping a session removes the container and keeps the volume, a
// later create with the same id mounts it again (a resume), and only destroy
// deletes it.
//
// The objects in Incus are the source of truth and this process's maps only a
// cache: a session's identity, owner, creation stamp and pin are `user.*`
// labels on its instance, so a restarted spawner re-adopts everything from a
// listing. Names are deterministic (incus-naming.ts) except for an instance
// claimed from the warm pool, which keeps the name it was made with and is
// found by its label.
//
// Incus has no preconditioned stop or delete. A fenced operation (one given
// the creation stamp it expects) therefore reads the instance, compares its
// stamp and Incus's own creation time, and acts on that instance: the route
// layer serializes the operations of one session id, and the removal re-checks
// the creation time while the instance goes.

import { isIpv4Address } from '../../network-address.ts';
import {
  outsideOperationBudget,
  withOperationBudget,
} from '../../operation-budget.ts';
import {
  runnerdEnvPatch as defaultRunnerdEnvPatch,
  runnerdHealth as defaultRunnerdHealth,
} from '../../session/runnerd-client.ts';
import {
  RUNNERD_PORT,
  type RunnerdHealth,
} from '../../session/runnerd-protocol.ts';
import {
  belongsToInstance,
  deriveRunnerdToken,
} from '../../session/session-naming.ts';
import { isAgentSessionProfile } from '../../session/session-profile.ts';
import type { SpawnerConfig } from '../../types.ts';
import { ID_ALPHABET_RE } from '../../wire.ts';
import {
  SessionExistsError,
  SessionIncarnationChangedError,
  type BackendSession,
  type BackendWorkspace,
  type CreateSessionResult,
  type OrganizationTeardownResult,
  type SessionBackend,
  type SessionSpec,
  type StopSessionOptions,
  type WorkspaceDeletion,
} from '../types.ts';
import {
  incusStatus,
  type IncusInstance,
  type IncusInstanceState,
} from './incus-api.ts';
import {
  isIncusImageMissing,
  isIncusNameConflict,
  type IncusClient,
} from './incus-client.ts';
import {
  hasEnded,
  instanceAddress,
  isRunning,
  isStartingOrRunning,
  startupExpired,
} from './incus-lifecycle.ts';
import {
  incusInstanceName,
  incusWorkspaceVolumeName,
  isScratchVolume,
  isSessionInstance,
  label,
  LABEL,
  stampOf,
} from './incus-naming.ts';
import { removeIncusInstance } from './incus-remove.ts';
import { getIncusRuntime, type IncusRuntime } from './incus-runtime.ts';
import {
  buildSessionInstance,
  buildWorkspaceVolume,
  pinnedEgressAddress,
  poolServes,
  poolShape,
  sessionShape,
  type SessionInstanceInput,
} from './incus-session-spec.ts';

/** How much of an instance's console log an error quotes. */
const LOG_TAIL_BYTES = 2_000;
/** A failed create's cleanup runs outside the create's spent budget. */
const CLEANUP_BUDGET_MS = 30_000;
/** How often a create asks runnerd whether it is ready, as on Docker. */
const RUNNERD_READY_POLL_MS = 100;
/** How often it looks at the instance (its address, whether it still runs)
 * while runnerd has not answered: every this many polls. */
const INSTANCE_LOOK_EVERY_POLLS = 5;
/** Waiting for the address DHCP gives the instance. */
const ADDRESS_POLL_MS = 250;
/** A volume an instance has only just let go of is refused for a moment. */
const VOLUME_DELETE_ATTEMPTS = 5;
const VOLUME_DELETE_RETRY_MS = 300;

export interface IncusSessionBackendDeps {
  /** Shared with the host backend; defaults to the config's own. */
  runtime?: IncusRuntime;
  runnerdHealth?: typeof defaultRunnerdHealth;
  runnerdEnvPatch?: typeof defaultRunnerdEnvPatch;
}

/** What a create made, so that a failure removes that and nothing else. */
interface CreateOwnership {
  /** The workspace volume this attempt made. */
  volumeCreated: boolean;
  /** Set once an instance may exist because of this attempt. */
  instanceMade: boolean;
}

interface Holder {
  instance: IncusInstance;
  etag: string | undefined;
  /** Runtime state, read when asked for. */
  state?: IncusInstanceState | undefined;
}

export class IncusSessionBackend implements SessionBackend {
  readonly kind = 'incus' as const;
  private readonly runtime: IncusRuntime;
  private readonly health: typeof defaultRunnerdHealth;
  private readonly envPatch: typeof defaultRunnerdEnvPatch;
  /** The instance a session was last found under, for the ones that do not
   * carry their deterministic name (a claimed standby keeps its own). */
  private readonly names = new Map<string, string>();
  private runtimeImageMissing: ((detail: string) => void) | null = null;

  constructor(
    private readonly cfg: SpawnerConfig,
    deps: IncusSessionBackendDeps = {},
  ) {
    this.runtime = deps.runtime ?? getIncusRuntime(cfg);
    this.health = deps.runnerdHealth ?? defaultRunnerdHealth;
    this.envPatch = deps.runnerdEnvPatch ?? defaultRunnerdEnvPatch;
  }

  onRuntimeImageMissing(listener: (detail: string) => void): void {
    this.runtimeImageMissing = listener;
  }

  /** The address a session booting now pins its transparent egress to. The
   * proxy is named by an IPv4 literal under this backend, so it only moves
   * when the configuration does; a session that pinned another address is
   * then recycled once it is released, and finds the proxy where it is now. */
  async egressAddress(): Promise<string | null> {
    return pinnedEgressAddress(this.cfg, poolShape(this.cfg)) ?? null;
  }

  private async api(): Promise<IncusClient> {
    return (await this.runtime.connect()).client;
  }

  private tokenFor(sessionId: string): string {
    return deriveRunnerdToken(this.cfg.sandboxToken, sessionId);
  }

  // ---- finding a session's instance ----------------------------------------

  private isSessionOf(instance: IncusInstance, sessionId: string): boolean {
    return (
      isSessionInstance(instance.config, this.cfg.instance) &&
      label(instance.config, LABEL.session) === sessionId
    );
  }

  /**
   * The instance of the session: under its deterministic name, or the name it
   * was last found under, or else by its label (a standby claimed from the
   * pool keeps the name it was made with). Undefined when there is none.
   */
  private async locate(
    sessionId: string,
    options: { state?: boolean } = {},
  ): Promise<Holder | undefined> {
    const client = await this.api();
    const read = async (name: string): Promise<Holder | undefined> =>
      options.state === true
        ? client.getInstanceFull(name)
        : client.getInstance(name);
    const deterministic = incusInstanceName(sessionId);
    const hinted = this.names.get(sessionId);
    for (const name of new Set(
      hinted === undefined ? [deterministic] : [deterministic, hinted],
    )) {
      const found = await read(name);
      if (found !== undefined && this.isSessionOf(found.instance, sessionId)) {
        if (name === deterministic) this.names.delete(sessionId);
        return found;
      }
      if (found === undefined && name === hinted) this.names.delete(sessionId);
    }
    const listed = (await client.listInstances()).filter((instance) =>
      this.isSessionOf(instance, sessionId),
    );
    const chosen = pickInstance(listed);
    if (chosen === undefined) return undefined;
    this.names.set(sessionId, chosen.name);
    return read(chosen.name);
  }

  // ---- create --------------------------------------------------------------

  async createSession(spec: SessionSpec): Promise<CreateSessionResult> {
    const { client } = await this.runtime.connect();
    const attemptId = this.runtime.attemptId();
    const ownership: CreateOwnership = {
      volumeCreated: false,
      instanceMade: false,
    };
    this.runtime.inFlight.add(spec.sessionId);
    try {
      return await withOperationBudget(
        this.cfg.session.createHealthTimeoutMs,
        async (signal) => {
          try {
            const created = await this.createWithinBudget(
              spec,
              attemptId,
              signal,
              ownership,
            );
            signal.throwIfAborted();
            return created;
          } catch (error) {
            // A live session under the id is the caller's to adopt: nothing
            // was made here, and nothing of it is ours to remove.
            if (!(error instanceof SessionExistsError)) {
              await this.cleanupFailedCreate(
                client,
                spec,
                attemptId,
                ownership,
              );
            }
            throw error;
          }
        },
        spec.signal,
      );
    } finally {
      this.runtime.inFlight.delete(spec.sessionId);
    }
  }

  private async createWithinBudget(
    spec: SessionSpec,
    attemptId: string,
    signal: AbortSignal,
    ownership: CreateOwnership,
  ): Promise<CreateSessionResult> {
    const { client, pool } = await this.runtime.connect();
    const deadline =
      this.runtime.now() + this.cfg.session.createHealthTimeoutMs;
    const durable = isAgentSessionProfile(spec.profile);
    const shape = sessionShape(this.cfg, spec.profile, spec.docker);
    const token = this.tokenFor(spec.sessionId);

    // A live session under the id is a duplicate; a dead one is debris.
    await this.settleHolder(client, spec.sessionId);
    signal.throwIfAborted();

    const preexisting = await this.ensureWorkspace(
      client,
      spec,
      durable,
      ownership,
    );
    signal.throwIfAborted();

    const egressAddress = pinnedEgressAddress(this.cfg, shape);
    const input: SessionInstanceInput = {
      sessionId: spec.sessionId,
      organizationId: spec.organizationId,
      profile: spec.profile,
      ...(spec.docker === undefined ? {} : { docker: spec.docker }),
      createdAtMs: spec.createdAtMs,
      createAttemptId: attemptId,
      runnerdToken: token,
      ...(egressAddress === undefined ? {} : { egressAddress }),
      startupDeadlineMs: deadline,
    };

    let name: string | undefined;
    if (poolServes(poolShape(this.cfg), shape)) {
      // The claim labels the standby with this attempt: from here on a
      // failure removes it like any instance this create made.
      ownership.instanceMade = true;
      name = await pool.claim(input, shape);
      if (name === undefined) ownership.instanceMade = false;
    }
    if (name === undefined) {
      // A cold start takes a slot of its own: standbys give theirs back.
      await pool.makeRoom(0).catch((error: unknown) => {
        console.warn(
          `[sandbox.session] making room in the warm pool for ${spec.sessionId} failed:`,
          error,
        );
      });
      signal.throwIfAborted();
      name = await this.createCold(client, input, deadline, signal, ownership);
    }
    if (name !== incusInstanceName(spec.sessionId)) {
      this.names.set(spec.sessionId, name);
    }

    // Poll runnerd until ready; on failure the caller removes only this
    // attempt's instance and keeps the workspace volume.
    const { health: readiness, baseUrl } = await this.waitForRunnerd(
      name,
      token,
      deadline,
      signal,
    );
    // The seed env goes to runnerd now that it is ready and BEFORE the create
    // returns, so no exec can start without it. Fail-closed: a failed patch
    // fails the create. It never reaches the instance config, which anyone
    // who can read the instance could read.
    if (Object.keys(spec.env).length > 0) {
      const denied = await this.envPatch(
        { baseUrl, token },
        { set: spec.env },
        signal,
      );
      if (denied.length > 0) {
        console.warn(
          `[sandbox.session] runnerd rejected seed env keys for ${spec.sessionId}: ${denied.join(', ')}`,
        );
      }
    }
    signal.throwIfAborted();
    return {
      resumed: preexisting,
      ...(readiness.incarnation === undefined
        ? {}
        : { incarnation: readiness.incarnation }),
      ...(egressAddress === undefined ? {} : { egressAddress }),
    };
  }

  /**
   * Before anything is made: a live session under the id means the caller
   * adopts it (SessionExistsError); one that has ended is removed so its name
   * is free; one that is stopping or not understood is a conflict the
   * platform retries.
   */
  private async settleHolder(
    client: IncusClient,
    sessionId: string,
  ): Promise<void> {
    const holder = await this.locate(sessionId);
    if (holder === undefined) return;
    const { instance } = holder;
    if (isStartingOrRunning(instance)) {
      throw new SessionExistsError(
        sessionId,
        `instance ${instance.name} is ${instance.status.toLowerCase()}`,
      );
    }
    if (!hasEnded(instance)) {
      throw new Error(
        `session ${sessionId} already exists (instance ${instance.name} is ${instance.status.toLowerCase()})`,
      );
    }
    console.warn(
      `[sandbox.session] removing ${instance.name} (${instance.status.toLowerCase()}) and creating ${sessionId} afresh`,
    );
    const removal = await removeIncusInstance(client, instance.name, {
      sleep: this.runtime.sleep,
      createdAt: instance.createdAt,
    });
    if (removal === 'replaced') {
      throw new Error(
        `session ${sessionId} already exists (another instance took ${instance.name})`,
      );
    }
    this.names.delete(sessionId);
  }

  /** Does the session's workspace volume exist, creating it when it does
   * not? True for a resume. A render session's scratch volume is made
   * afresh every time. */
  private async ensureWorkspace(
    client: IncusClient,
    spec: SessionSpec,
    durable: boolean,
    ownership: CreateOwnership,
  ): Promise<boolean> {
    const { storagePool } = this.runtime.incus;
    const name = incusWorkspaceVolumeName(spec.sessionId);
    const existing = await client.getVolume(storagePool, name);
    if (existing !== undefined) {
      if (label(existing.config, LABEL.session) !== spec.sessionId) {
        throw new Error(
          `the volume ${name} exists but does not belong to session ${spec.sessionId}`,
        );
      }
      if (durable) return true;
      // The scratch of an earlier render session under this id; anything else
      // under it is a workspace, which a render never replaces.
      if (!isScratchVolume(existing.config)) {
        throw new Error(
          `the volume ${name} is a workspace, not the scratch of a render session`,
        );
      }
      await client.deleteVolume(storagePool, name);
    }
    const body = buildWorkspaceVolume(
      this.cfg,
      {
        sessionId: spec.sessionId,
        organizationId: spec.organizationId,
        profile: spec.profile,
      },
      await this.runtime.storageDriver(),
    );
    try {
      await client.createVolume(storagePool, body);
      ownership.volumeCreated = true;
    } catch (error) {
      // A concurrent ensure won: the volume is there, which is all this needs.
      if (!isIncusNameConflict(error)) throw error;
      return durable;
    }
    return false;
  }

  private async createCold(
    client: IncusClient,
    input: SessionInstanceInput,
    deadlineMs: number,
    signal: AbortSignal,
    ownership: CreateOwnership,
  ): Promise<string> {
    const body = buildSessionInstance(this.cfg, input);
    // Set before the call: a reply lost on the wire may follow a create that
    // happened, and the cleanup then looks for it by this attempt's label.
    ownership.instanceMade = true;
    try {
      await client.createInstance(
        body,
        Math.max(1_000, deadlineMs - this.runtime.now()),
        signal,
      );
    } catch (error) {
      if (isIncusNameConflict(error)) {
        // The name is taken by an instance that is not this attempt's: not
        // ours to remove.
        ownership.instanceMade = false;
        throw await this.conflictError(input.sessionId, error);
      }
      // The run never pulls: a missing image fails at once, and the host
      // backend's warm-up brings it back outside any create's budget.
      if (isIncusImageMissing(error)) {
        this.runtimeImageMissing?.(
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
    return body.name;
  }

  /** A create that lost the deterministic-name race. A live instance under
   * the name is a session the registry does not hold, which the route
   * answers as a duplicate; anything else is a failure to retry. */
  private async conflictError(
    sessionId: string,
    cause: unknown,
  ): Promise<Error> {
    let holder: Holder | undefined;
    try {
      holder = await this.locate(sessionId);
    } catch (error) {
      console.warn(
        `[sandbox.session] cannot tell whose instance holds ${sessionId}'s name:`,
        error,
      );
    }
    if (holder !== undefined && isStartingOrRunning(holder.instance)) {
      return new SessionExistsError(
        sessionId,
        `instance ${holder.instance.name} holds its name`,
        { cause },
      );
    }
    return new Error(
      `session ${sessionId} already exists (concurrent create or unadopted instance)`,
      { cause },
    );
  }

  /**
   * Poll runnerd's /healthz until it is ready, but fail fast when the
   * instance has ended: a boot crash (the entrypoint's tier assertion, a
   * workspace it cannot write) would otherwise burn the whole create budget
   * blind-polling an instance that stopped in its first second — and an
   * ephemeral instance deletes itself the moment it stops, so its console is
   * read while it still runs and quoted from memory.
   */
  private async waitForRunnerd(
    name: string,
    token: string,
    deadlineMs: number,
    signal: AbortSignal,
  ): Promise<{ health: RunnerdHealth; baseUrl: string }> {
    const client = await this.api();
    let baseUrl: string | undefined;
    let lastLog = '';
    let logWarned = false;
    for (let poll = 0; ; poll += 1) {
      signal.throwIfAborted();
      if (baseUrl === undefined || poll % INSTANCE_LOOK_EVERY_POLLS === 0) {
        const found = await client.getInstanceFull(name);
        if (found === undefined || hasEnded(found.instance)) {
          throw new Error(
            `the session instance ${name} ${found === undefined ? 'is gone' : 'stopped'} before runnerd became ready${quoted(lastLog)}`,
          );
        }
        const address = instanceAddress(found.state);
        if (address !== undefined)
          baseUrl = `http://${address}:${RUNNERD_PORT}`;
        if (isRunning(found.instance)) {
          try {
            lastLog = await client.getConsoleLog(name, LOG_TAIL_BYTES);
          } catch (error) {
            // A diagnostic only: said once, not at every look.
            if (!logWarned) {
              logWarned = true;
              console.warn(
                `[sandbox.session] cannot read the console of ${name}:`,
                error instanceof Error ? error.message : error,
              );
            }
          }
        }
      }
      if (baseUrl !== undefined) {
        try {
          const health = await this.health({ baseUrl, token }, signal);
          signal.throwIfAborted();
          if (health.dockerReady === false) {
            throw new Error('runnerd is live but inner Docker is not ready');
          }
          return { health, baseUrl };
        } catch {
          // Not up yet: the poll goes on until the deadline.
          signal.throwIfAborted();
        }
      }
      if (this.runtime.now() > deadlineMs) {
        throw new Error(
          `runnerd did not become ready within ${this.cfg.session.createHealthTimeoutMs}ms${baseUrl === undefined ? ' (the instance never got an address)' : ''}${quoted(lastLog)}`,
        );
      }
      await this.runtime.sleep(
        baseUrl === undefined ? ADDRESS_POLL_MS : RUNNERD_READY_POLL_MS,
      );
    }
  }

  /** A failed create owns the instance carrying its random attempt label, and
   * the scratch volume of a render session it made. A durable workspace may
   * already serve a peer or a retry: it stays. */
  private async cleanupFailedCreate(
    client: IncusClient,
    spec: SessionSpec,
    attemptId: string,
    ownership: CreateOwnership,
  ): Promise<void> {
    try {
      await outsideOperationBudget(() =>
        withOperationBudget(CLEANUP_BUDGET_MS, async () => {
          if (ownership.instanceMade) {
            const holder = await this.locate(spec.sessionId);
            if (
              holder !== undefined &&
              label(holder.instance.config, LABEL.createAttempt) === attemptId
            ) {
              await removeIncusInstance(client, holder.instance.name, {
                sleep: this.runtime.sleep,
                createdAt: holder.instance.createdAt,
              });
              this.names.delete(spec.sessionId);
            }
          }
          if (!isAgentSessionProfile(spec.profile) && ownership.volumeCreated) {
            await this.deleteScratch(client, spec.sessionId);
          }
        }),
      );
    } catch (error) {
      console.warn(
        `[sandbox.session] failed-create cleanup skipped for ${spec.sessionId}:`,
        error,
      );
    }
  }

  // ---- looking at a session ------------------------------------------------

  async resolveEndpoint(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<string> {
    const holder = await this.locate(sessionId, { state: true });
    if (holder === undefined) {
      if (expectedCreatedAtMs !== undefined) {
        throw new SessionIncarnationChangedError(
          sessionId,
          'instance gone before endpoint resolution',
        );
      }
      throw new Error(`session ${sessionId} has no instance`);
    }
    if (
      expectedCreatedAtMs !== undefined &&
      this.observedStamp(sessionId, holder.instance) !== expectedCreatedAtMs
    ) {
      throw new SessionIncarnationChangedError(
        sessionId,
        'instance changed before endpoint resolution',
      );
    }
    const address = instanceAddress(holder.state);
    if (address === undefined) {
      throw new Error(`session ${sessionId} has no address`);
    }
    return `http://${address}:${RUNNERD_PORT}`;
  }

  private observedStamp(sessionId: string, instance: IncusInstance): number {
    const stamp = stampOf(instance.config);
    if (stamp === undefined) {
      throw new Error(
        `session ${sessionId} instance creation stamp is unreadable`,
      );
    }
    return stamp;
  }

  async sessionExists(
    sessionId: string,
    expectedCreatedAtMs?: number,
  ): Promise<boolean> {
    // Only a definitive "no instance" answers false; a hiccup throws and the
    // caller treats it as unknown.
    const holder = await this.locate(sessionId);
    if (holder === undefined || !isRunning(holder.instance)) return false;
    return (
      expectedCreatedAtMs === undefined ||
      this.observedStamp(sessionId, holder.instance) === expectedCreatedAtMs
    );
  }

  async hasWorkspace(sessionId: string): Promise<boolean> {
    const client = await this.api();
    const volume = await client.getVolume(
      this.runtime.incus.storagePool,
      incusWorkspaceVolumeName(sessionId),
    );
    if (volume !== undefined) return true;
    return (await this.locate(sessionId)) !== undefined;
  }

  // ---- stop, destroy -------------------------------------------------------

  /** The instance meant by a fenced operation: undefined when there is none,
   * SessionIncarnationChangedError when its stamp is not the one expected. */
  private async fenced(
    sessionId: string,
    expectedCreatedAtMs: number | undefined,
    what: string,
  ): Promise<Holder | undefined> {
    const holder = await this.locate(sessionId);
    if (
      holder !== undefined &&
      expectedCreatedAtMs !== undefined &&
      (stampOf(holder.instance.config) ?? 0) !== expectedCreatedAtMs
    ) {
      throw new SessionIncarnationChangedError(sessionId, what);
    }
    return holder;
  }

  async stopSession(
    sessionId: string,
    expectedCreatedAtMs?: number,
    options: StopSessionOptions = {},
  ): Promise<boolean> {
    const client = await this.api();
    const holder = await this.fenced(
      sessionId,
      expectedCreatedAtMs,
      'instance creation stamp moved',
    );
    if (holder === undefined) return false;
    const { instance } = holder;
    const removal = await removeIncusInstance(client, instance.name, {
      sleep: this.runtime.sleep,
      createdAt: instance.createdAt,
      ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
    });
    if (removal === 'replaced') {
      // Our instance is gone (or was never the one meant) and another holds
      // the name: not ours to count as freed.
      throw new SessionIncarnationChangedError(
        sessionId,
        'replaced while terminating',
      );
    }
    this.names.delete(sessionId);
    // A render session's scratch goes with its instance; an agent session's
    // workspace is what a resume mounts.
    if (!isAgentSessionProfile(label(instance.config, LABEL.profile))) {
      await this.deleteScratch(client, sessionId);
    }
    return removal === 'removed';
  }

  /** The scratch volume of a render session; a failure is logged, the
   * orphan sweep takes it later. Only a volume that records itself as scratch
   * is deleted, whatever the caller believes: a workspace is never taken. */
  private async deleteScratch(
    client: IncusClient,
    sessionId: string,
  ): Promise<void> {
    try {
      const volume = await client.getVolume(
        this.runtime.incus.storagePool,
        incusWorkspaceVolumeName(sessionId),
      );
      if (volume === undefined) return;
      if (!isScratchVolume(volume.config)) {
        console.warn(
          `[sandbox.session] ${volume.name} is not marked as the scratch of a render session; left in place`,
        );
        return;
      }
      await this.deleteVolumeWhenFree(client, sessionId);
    } catch (error) {
      console.warn(
        `[sandbox.session] the scratch volume of ${sessionId} stays for the orphan sweep:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** Delete the workspace volume, once the instance that used it has let go.
   * False when there was none. */
  private async deleteVolumeWhenFree(
    client: IncusClient,
    sessionId: string,
  ): Promise<boolean> {
    const { storagePool } = this.runtime.incus;
    const name = incusWorkspaceVolumeName(sessionId);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await client.deleteVolume(storagePool, name);
      } catch (error) {
        const status = incusStatus(error);
        const inUse =
          (status === 400 || status === 409 || status === 500) &&
          /in use|used by/i.test(
            error instanceof Error ? error.message : String(error),
          );
        if (!inUse || attempt >= VOLUME_DELETE_ATTEMPTS) throw error;
        await this.runtime.sleep(VOLUME_DELETE_RETRY_MS);
      }
    }
  }

  async destroySession(sessionId: string): Promise<boolean> {
    const client = await this.api();
    const holder = await this.locate(sessionId);
    let existed = false;
    if (holder !== undefined) {
      const removal = await removeIncusInstance(client, holder.instance.name, {
        sleep: this.runtime.sleep,
        createdAt: holder.instance.createdAt,
      });
      if (removal === 'replaced') {
        throw new SessionIncarnationChangedError(
          sessionId,
          'replaced while terminating',
        );
      }
      existed = removal === 'removed';
    }
    // CONFIRM the instance is gone before deleting the workspace: a wedged
    // node that ignored the stop would otherwise leave a gutted-but-running
    // instance. An unknown answer throws and the caller retries.
    if ((await this.locate(sessionId)) !== undefined) {
      throw new Error(
        `destroy ${sessionId}: instance still present after removal — workspace left intact`,
      );
    }
    this.names.delete(sessionId);
    // The data-deleting half of the ONLY data-deleting verb. Its failure must
    // propagate: swallowed, the route would answer destroyed:true while the
    // user's data survived under the session's name.
    let hadWorkspace: boolean;
    try {
      hadWorkspace = await this.deleteVolumeWhenFree(client, sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `destroy ${sessionId}: instance removed but its workspace volume could not be deleted: ${message}`,
        { cause: error },
      );
    }
    return existed || hadWorkspace;
  }

  /** Deleting a volume is synchronous: it is gone when the call returns. So
   * a destroy that answered has finished, and the answer is `done` unless a
   * volume of the id exists, which a destroy that failed (it throws, and is
   * tried again) or a workspace made since leaves. The volume of an id is
   * never deleted from here: it may be a live session's. */
  async workspaceDeletion(
    sessionId: string,
    waitMs = 0,
  ): Promise<WorkspaceDeletion> {
    const client = await this.api();
    const name = incusWorkspaceVolumeName(sessionId);
    const deadline = this.runtime.now() + waitMs;
    for (;;) {
      const volume = await client.getVolume(
        this.runtime.incus.storagePool,
        name,
      );
      if (volume === undefined) return 'done';
      if (this.runtime.now() >= deadline) return 'pending';
      await this.runtime.sleep(Math.min(500, deadline - this.runtime.now()));
    }
  }

  /** An instance that never got going — past its create's whole budget and
   * slack, and not running — is removed like a stop removes one, its
   * workspace kept. Fenced to the incarnation the caller listed. False when
   * it is not provably abandoned; true when it is gone. */
  async reapStaleSession(
    sessionId: string,
    expectedCreatedAtMs: number,
  ): Promise<boolean> {
    const client = await this.api();
    const holder = await this.locate(sessionId);
    if (holder === undefined) return true;
    const { instance } = holder;
    const stamp = stampOf(instance.config);
    if (
      isRunning(instance) ||
      stamp === undefined ||
      stamp <= 0 ||
      stamp !== expectedCreatedAtMs ||
      !startupExpired(
        instance,
        this.runtime.now(),
        this.cfg.session.createHealthTimeoutMs,
      )
    ) {
      return false;
    }
    const removal = await removeIncusInstance(client, instance.name, {
      sleep: this.runtime.sleep,
      createdAt: instance.createdAt,
    });
    if (removal === 'replaced') return false;
    this.names.delete(sessionId);
    console.warn(
      `[sandbox.session] removed ${sessionId}'s instance, stuck ${instance.status.toLowerCase()} since ${instance.createdAt}`,
    );
    return true;
  }

  // ---- the durable pin -----------------------------------------------------

  /**
   * The "always-on" pin lives on the instance as a label, so a restarted
   * spawner re-adopts it from the same object. A new instance (a create or a
   * resume) carries none — the platform's row is the truth and it re-pushes;
   * stop and destroy remove the instance and the label with it. The write
   * carries the ETag it was read with, so it cannot land on a replacement.
   */
  async setPinned(
    sessionId: string,
    pinned: boolean,
    expectedCreatedAtMs?: number,
  ): Promise<void> {
    const client = await this.api();
    for (let attempt = 1; ; attempt += 1) {
      const holder = await this.locate(sessionId);
      if (holder === undefined) {
        if (expectedCreatedAtMs !== undefined) {
          throw new SessionIncarnationChangedError(
            sessionId,
            'instance is gone',
          );
        }
        if (!pinned) return;
        throw new Error(`session ${sessionId} has no instance to pin`);
      }
      if (
        expectedCreatedAtMs !== undefined &&
        (stampOf(holder.instance.config) ?? 0) !== expectedCreatedAtMs
      ) {
        throw new SessionIncarnationChangedError(
          sessionId,
          'instance changed before pin persistence',
        );
      }
      try {
        await client.patchInstance(
          holder.instance.name,
          // An emptied key reads as removed.
          { config: { [LABEL.pinned]: pinned ? 'true' : '' } },
          holder.etag === undefined ? {} : { ifMatch: holder.etag },
        );
        return;
      } catch (error) {
        // Changed since it was read (another label written): look again.
        if (incusStatus(error) === 412 && attempt < 3) continue;
        throw error;
      }
    }
  }

  // ---- listing -------------------------------------------------------------

  async listSessions(organizationId?: string): Promise<BackendSession[]> {
    // THROWS on a failed list, never `[]`: the callers read an empty list as
    // "no sessions", and a blip laundered into [] would leave every running
    // session unregistered — unroutable and never reaped.
    const client = await this.api();
    const instances = await client.listInstances();
    const mine = instances.filter((instance) =>
      isSessionInstance(instance.config, this.cfg.instance),
    );
    // Two instances for one id (a claim that was not cleaned up beside a
    // cold start): the running, newest one is the session.
    const byId = new Map<string, IncusInstance[]>();
    for (const instance of mine) {
      const id = label(instance.config, LABEL.session);
      if (id === undefined) continue;
      byId.set(id, [...(byId.get(id) ?? []), instance]);
    }
    const out: BackendSession[] = [];
    for (const [sessionId, candidates] of byId) {
      const instance = pickInstance(candidates);
      if (instance === undefined) continue;
      if (candidates.length > 1) {
        console.warn(
          `[sandbox.session] ${candidates.length} instances carry session ${sessionId} (${candidates.map((c) => c.name).join(', ')}); ${instance.name} is the one listed`,
        );
      }
      if (instance.name === incusInstanceName(sessionId)) {
        this.names.delete(sessionId);
      } else {
        this.names.set(sessionId, instance.name);
      }
      const org = label(instance.config, LABEL.organization) ?? '';
      if (organizationId && org !== organizationId) continue;
      const profile = label(instance.config, LABEL.profile);
      const docker = label(instance.config, LABEL.docker);
      const egress = label(instance.config, LABEL.egress);
      out.push({
        sessionId,
        organizationId: org,
        profile: isAgentSessionProfile(profile) ? profile : 'default',
        ...(docker === 'true' || docker === 'false'
          ? { docker: docker === 'true' }
          : {}),
        createdAtMs: stampOf(instance.config) ?? 0,
        ttlMs: this.cfg.session.maxLifetimeMs,
        idleTimeoutMs: this.cfg.session.maxIdleMs,
        state: isRunning(instance) ? 'ready' : 'degraded',
        pinned: label(instance.config, LABEL.pinned) === 'true',
        ended: hasEnded(instance),
        ...(isIpv4Address(egress) ? { egressAddress: egress } : {}),
      });
    }
    return out;
  }

  /** Every workspace volume, joined with the session instances beside them.
   * Both lists THROW after their retries; a render session's scratch volume
   * is not a workspace the platform keeps records of. */
  async listWorkspaces(): Promise<BackendWorkspace[]> {
    const client = await this.api();
    const volumes = await client.listVolumes(this.runtime.incus.storagePool);
    const sessions = new Map(
      (await this.listSessions()).map((session) => [
        session.sessionId,
        session,
      ]),
    );
    const workspaces: BackendWorkspace[] = [];
    for (const volume of volumes) {
      if (label(volume.config, LABEL.workspace) !== '1') continue;
      if (
        !belongsToInstance(
          label(volume.config, LABEL.spawnerInstance),
          this.cfg.instance,
        )
      ) {
        continue;
      }
      const sessionId = label(volume.config, LABEL.session);
      if (sessionId === undefined || !ID_ALPHABET_RE.test(sessionId)) continue;
      if (!isAgentSessionProfile(label(volume.config, LABEL.profile))) continue;
      const session = sessions.get(sessionId);
      const organizationId =
        (session?.organizationId ?? '') ||
        (label(volume.config, LABEL.organization) ?? '');
      workspaces.push({
        sessionId,
        touchedAtMs: volume.createdAtMs,
        active: session !== undefined && session.ended !== true,
        pinned: session?.pinned === true,
        ...(organizationId === '' ? {} : { organizationId }),
      });
    }
    return workspaces;
  }

  // Incus sessions keep nothing per organization beyond their own workspace
  // volumes: Docker builds happen inside the session, and there are no
  // shared package caches.
  async listOrganizationResources(): Promise<string[]> {
    return [];
  }

  async teardownOrganization(): Promise<OrganizationTeardownResult> {
    return { containers: 0, volumes: 0, networks: 0 };
  }

  // No shared cross-session build cache here: DinD is inside the session.
  async reconcileBuildCache(): Promise<void> {}
}

/** The instance that stands for a session when several carry its label: a
 * running one, the newest stamp first. */
function pickInstance(instances: IncusInstance[]): IncusInstance | undefined {
  return [...instances].sort(
    (a, b) =>
      Number(isRunning(b)) - Number(isRunning(a)) ||
      (stampOf(b.config) ?? 0) - (stampOf(a.config) ?? 0),
  )[0];
}

function quoted(log: string): string {
  const tail = log.trim();
  return tail === '' ? '' : `; last console lines:\n${tail}`;
}
