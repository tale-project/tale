/**
 * The container runtime a workspace deployment runs on, behind one interface.
 *
 * Every action that touches the stack's instances, images, volumes or
 * networks asks a `StackRuntime` instead of building `docker` argv itself.
 * `selectRuntime` picks the runtime once per command from what `tale.json`
 * declares; Docker is the default and, until the Incus runtime exists, the
 * only one.
 *
 * The verbs mirror what the CLI does to a stack today. The Docker runtime
 * (`docker/docker-runtime.ts`) answers each with exactly the `lib/docker`
 * function the actions called before, so Docker's argv does not change. The
 * reads an action makes about one instance (`exists`, `isRunning`, `state`,
 * `version`, `health`) stay separate verbs for that reason: each is one call
 * on Docker today and one call on Incus later.
 */

import type { DeploymentColor } from '../compose/types';
import type { ExecResult } from '../docker/exec';

export type { ExecResult };

export const RUNTIME_ENGINES = ['docker', 'incus'] as const;
export type RuntimeEngine = (typeof RUNTIME_ENGINES)[number];

/** Where one instance of the stack sits, on any runtime. */
export interface InstanceRef {
  /** `<id>`, `<id>-blue`, `<id>-green`, `<id>-dev`, or a managed compose project. */
  stack: string;
  /** The compose service it runs (`platform`, `backend-api`, …). */
  service: string;
  /** The replica index, 1-based; 1 for an unscaled service. */
  index: number;
  /** The colour whose stack it belongs to, when it belongs to one. */
  colour?: DeploymentColor;
  /** A one-off run (`compose run`), never a replica of its service. */
  oneOff: boolean;
  /** The container or instance name the runtime knows it by. */
  name: string;
}

/** One instance as the census lists it: cheap to read for a whole stack. */
export interface InstanceSummary extends InstanceRef {
  /** Whether its state is exactly `running`. */
  running: boolean;
  /**
   * Its state in Docker's words: `created`, `running`, `restarting`,
   * `paused`, `removing`, `exited` or `dead`. Another runtime maps its own
   * states onto these, so a refusal names a state the same way everywhere.
   */
  state: string;
}

/**
 * The environment keys an instance readback may carry: none of them holds a
 * secret. The rest of an instance's environment never leaves the runtime: a
 * status line, a refusal or a debug log built from a readback cannot print a
 * password, because the readback does not have it.
 */
export const INSTANCE_ENVIRONMENT_KEYS = [
  'VERSION',
  'TALE_VERSION',
  'TALE_ROLE',
  'TALE_DB_ROLE',
  'TALE_PROXY_ROLE',
  'SANDBOX_BACKEND',
] as const;
export type InstanceEnvironmentKey = (typeof INSTANCE_ENVIRONMENT_KEYS)[number];

/** The allow-listed part of an environment; every other key is dropped. */
export function pickInstanceEnvironment(
  environment: Readonly<Record<string, string>>,
): Partial<Record<InstanceEnvironmentKey, string>> {
  const picked: Partial<Record<InstanceEnvironmentKey, string>> = {};
  for (const key of INSTANCE_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

export interface InstanceMount {
  kind: 'volume' | 'bind' | 'files';
  source: string;
  target: string;
  readOnly: boolean;
}

/** One instance read back in full. */
export interface InstanceInfo extends InstanceSummary {
  startedAt: string | null;
  /** Restarted since it was created (Docker: `RestartCount > 0`). */
  restarted: boolean;
  image: {
    reference: string;
    /** The image's content identity (Docker: the local image ID). */
    digest: string | null;
    version: string | null;
    revision: string | null;
    automationWriterProtocol: string | null;
  };
  /** The allow-listed keys only, never the whole environment. */
  environment: Partial<Record<InstanceEnvironmentKey, string>>;
  /**
   * A keyed digest of the whole environment, so a readback shows that a
   * secret changed without carrying it; null where the runtime keeps none
   * (Docker).
   */
  environmentDigest: string | null;
  mounts: InstanceMount[];
  address: string | null;
  /** The runtime's record of the configuration it applied; null on Docker. */
  configDigest: string | null;
}

export type HealthState = 'healthy' | 'unhealthy' | 'starting' | 'none';

/** A check of the runtime itself, as the deploy preflight reports it. */
export interface RuntimeCheck {
  status: 'ok' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}

/** Whether the runtime is usable, after `probe` made it so where it can. */
export interface ProbeResult {
  status: 'ready' | 'installed' | 'refused' | 'failed';
  detail: string;
}

/** The stack document one `converge` brings up, and where it resolves from. */
export interface StackTarget {
  /** The stack (compose project) the services belong to. */
  stack: string;
  /** The compose document. */
  compose: string;
  /** The directory its relative paths (`env_file`) resolve from. */
  cwd: string;
}

/** Which services of a target one `converge` creates or replaces. */
export interface ConvergeScope {
  services: readonly string[];
  /** Replicas per service; a service without an entry runs its default. */
  scale?: Readonly<Partial<Record<string, number>>>;
  /** Replace instances whose configuration did not change too. */
  forceRecreate?: boolean;
}

export interface WaitHealthyOptions {
  /** Seconds. */
  timeout: number;
  /** Follow the instance's log while waiting. */
  streamLogs?: boolean;
}

export interface WaitServiceHealthyOptions extends WaitHealthyOptions {
  /** How many replicas the service must have; fewer fails the wait. */
  expectedReplicas: number;
}

export interface ExecOptions {
  /** Delivered on the process's stdin, never in its argv. */
  stdin?: string;
}

export interface FileOwner {
  user: string;
  group: string;
}

/** `copyIn` failed while copying, or while handing the files to `owner`. */
export type CopyResult =
  | { success: true }
  | { success: false; stage: 'copy' | 'owner'; detail: string };

export interface CopyOutOptions {
  /** A copy larger than this fails. */
  maxBytes: number;
  /** Seconds. */
  timeoutS: number;
}

export interface LogOptions {
  follow: boolean;
  since?: string;
  tail?: number;
}

/** A volume a one-shot job mounts. */
export interface JobMount {
  volume: string;
  target: string;
  readOnly?: boolean;
}

/** A short-lived helper that runs one command over volumes, then goes. */
export interface OneShotJob {
  image: string;
  mounts: readonly JobMount[];
  argv: readonly string[];
  /** Delivered on the job's stdin, never in its argv. */
  stdin?: string;
  /** Seconds. */
  timeoutS?: number;
}

export interface StackRuntime {
  readonly engine: RuntimeEngine;

  // Readiness
  /** Make the runtime usable where it can (Docker: start or install the
   *  engine, with consent) and say whether it is. */
  probe(options: { assumeYes?: boolean }): Promise<ProbeResult>;
  /** Whether the runtime answers at all. */
  checkReachable(): Promise<RuntimeCheck>;
  /** Whether a reachable runtime can run Tale. */
  checkEngine(): Promise<RuntimeCheck>;
  /** The cgroup version instances run under; null when unknown. */
  cgroupVersion(): Promise<1 | 2 | null>;

  // Census and readback
  /** Every replica the runtime created for `stack`, ordered by service then
   *  index, stopped ones included and one-off runs left out. */
  list(filter: { stack: string; service?: string }): Promise<InstanceSummary[]>;
  /** Every instance whose name contains `fragment`, with the runtime's own
   *  status line. */
  listByName(
    fragment: string,
  ): Promise<Array<{ name: string; status: string }>>;
  exists(name: string): Promise<boolean>;
  isRunning(name: string): Promise<boolean>;
  /** The state word (`InstanceSummary.state`); null when there is none. */
  state(name: string): Promise<string | null>;
  /** The platform version it runs; null when unknown or absent. */
  version(name: string): Promise<string | null>;
  health(name: string): Promise<HealthState>;
  /** The full readback of one instance; null when there is none. */
  inspect(name: string): Promise<InstanceInfo | null>;

  // Images
  pull(image: string): Promise<boolean>;
  imagePresent(image: string): Promise<boolean>;
  /** Give a local image a second name, as the sandbox spawner expects it. */
  tag(source: string, alias: string): Promise<ExecResult>;

  // Volumes and networks
  volumeExists(name: string): Promise<boolean>;
  /** Make each `${prefix}${name}` exist; the prefix defaults to the project's. */
  ensureVolumes(names: readonly string[], prefix?: string): Promise<boolean>;
  removeVolume(name: string): Promise<boolean>;
  /** How an operator deletes `name` by hand, when it exists; null when not. */
  volumeRemovalHint(name: string): Promise<string | null>;
  /** Carry the org config store over from its pre-rename volume, once. */
  migrateConfigVolume(prefix: string): Promise<void>;
  ensureNetwork(name: string): Promise<boolean>;
  ensureSandboxNetwork(): Promise<boolean>;
  /** Drop the project's networks nothing uses any more. */
  pruneNetworks(): Promise<ExecResult>;
  /** The running instances that mount `volume`. */
  volumeUsers(volume: string): Promise<string[]>;
  /** Run `work` with every running instance that mounts one of `volumes`
   *  frozen, then thaw them and wait until each that was healthy is again. */
  quiesce<T>(
    volumes: readonly string[],
    work: (frozenCount: number) => Promise<T>,
  ): Promise<T>;

  // Lifecycle
  /** Create or replace the scoped services of `target`. */
  converge(target: StackTarget, scope: ConvergeScope): Promise<ExecResult>;
  waitHealthy(name: string, options: WaitHealthyOptions): Promise<boolean>;
  /** Wait for EVERY replica of one service of `stack`. */
  waitServiceHealthy(
    stack: string,
    service: string,
    options: WaitServiceHealthyOptions,
  ): Promise<boolean>;
  /** Stop gracefully, within the instance's own stop grace. */
  stop(name: string): Promise<boolean>;
  /** Remove it, stopped or not; one that is gone counts as removed. */
  remove(name: string): Promise<boolean>;
  /** Let `services` of `stack` take traffic (Docker: they do from start). */
  admit(stack: string, services: readonly string[]): Promise<void>;
  /** Take `services` of `stack` out of the serving names, live connections
   *  included; returns how many instance links it cut. */
  withdraw(stack: string, services: readonly string[]): Promise<number>;
  /** Clean up what a deploy started in `stacks` when the process is
   *  interrupted. Synchronous: a signal handler cannot wait. */
  onInterrupt(stacks: readonly string[]): void;

  // Exec, files, logs
  exec(
    name: string,
    argv: readonly string[],
    options?: ExecOptions,
  ): Promise<ExecResult>;
  /** Copy the contents of the local `dir` into `target` in the instance. */
  copyIn(
    name: string,
    dir: string,
    target: string,
    owner?: FileOwner,
  ): Promise<CopyResult>;
  /** Copy the contents of `source` in the instance into the local `dir`. */
  copyOut(
    name: string,
    source: string,
    dir: string,
    options: CopyOutOptions,
  ): Promise<ExecResult>;
  /** Show the instance's log: on this process's own output without
   *  `onLine`, else line by line. Resolves with the reader's exit code. */
  logs(
    name: string,
    options: LogOptions,
    onLine?: (line: string) => void,
  ): Promise<number>;

  // Helpers
  /** Run one helper job over volumes and remove it. */
  oneShot(job: OneShotJob): Promise<ExecResult>;
}
