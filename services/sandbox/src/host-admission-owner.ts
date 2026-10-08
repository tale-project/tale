// Inactive foundation: one lifetime owner on a supported local Docker
// daemon. There is intentionally no TTL takeover or automatic deletion.
// Boot orchestration must establish exclusive mode before ALL writers and
// reconcile old intents before this fence can admit anything.
import { randomUUID } from 'node:crypto';
import { readFile, readlink } from 'node:fs/promises';

import type { HostAdmissionIdentity } from './host-admission-model.ts';
import { runDocker, type RunDockerResult } from './spawn-util.ts';

export const HOST_ADMISSION_OWNER_NAME = 'tale-native-host-admission-v1';
const LABEL = 'tale.host-admission.';
const CID = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STARTED = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/;

interface Dependencies {
  docker?: (args: string[], timeoutMs: number) => Promise<RunDockerResult>;
  readFile?: (path: string) => Promise<string>;
  readlink?: (path: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
  platform?: string;
  monotonic?: () => number;
}

interface Container {
  id: string;
  image: string;
  startedAt: string;
  running: boolean;
  status: string;
  pidMode: string;
  labels: Record<string, unknown>;
}

export interface HostAdmissionOwnerIdentity {
  daemonId: string;
  hostBootId: string;
  containerId: string;
  imageId: string;
  startedAt: string;
  generation: string;
  recordId: string;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid native admission owner projection');
  return Object.fromEntries(Object.entries(value));
}

function container(value: unknown): Container {
  const row = object(value);
  if (
    typeof row.id !== 'string' ||
    !CID.test(row.id) ||
    typeof row.image !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(row.image) ||
    typeof row.startedAt !== 'string' ||
    !STARTED.test(row.startedAt) ||
    typeof row.running !== 'boolean' ||
    typeof row.status !== 'string' ||
    typeof row.pidMode !== 'string'
  )
    throw new Error('Invalid native admission container identity');
  return {
    id: row.id,
    image: row.image,
    startedAt: row.startedAt,
    running: row.running,
    status: row.status,
    pidMode: row.pidMode,
    labels: object(row.labels ?? {}),
  };
}

const PROJECTION =
  '{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"status":{{json .State.Status}},"pidMode":{{json .HostConfig.PidMode}},"labels":{{json .Config.Labels}}}';

/** HOSTNAME locates a candidate, never proves self. Exact mount/PID
 * namespaces AND kernel boot identity must agree with a CID-bound exec.
 * A Unix socket path by itself does not prove a local physical host. */
export class DockerAdmissionOwner {
  private readonly docker: NonNullable<Dependencies['docker']>;
  private readonly read: NonNullable<Dependencies['readFile']>;
  private readonly link: NonNullable<Dependencies['readlink']>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: string;
  private readonly monotonic: () => number;
  private readonly generation = randomUUID();
  private owned: HostAdmissionOwnerIdentity | null = null;

  constructor(deps: Dependencies = {}) {
    this.docker =
      deps.docker ??
      ((args, timeoutMs) =>
        runDocker(args, {
          timeoutMs,
          priority: true,
          stdoutMaxBytes: 16 * 1024,
          stderrMaxBytes: 1024,
        }));
    this.read = deps.readFile ?? ((path) => readFile(path, 'utf8'));
    this.link = deps.readlink ?? readlink;
    this.env = deps.env ?? process.env;
    this.platform = deps.platform ?? process.platform;
    this.monotonic = deps.monotonic ?? (() => performance.now());
  }

  async acquire(recoverRetired = false): Promise<HostAdmissionOwnerIdentity> {
    if (this.owned) {
      await this.assertCurrent();
      return { ...this.owned };
    }
    const deadline = this.monotonic() + 30_000;
    const hostname = this.env.HOSTNAME;
    if (
      this.platform !== 'linux' ||
      !hostname ||
      !/^[a-f0-9]{12,64}$/.test(hostname)
    )
      throw new Error(
        'Native admission requires an identifiable Linux Docker container',
      );
    const endpoint =
      !this.env.DOCKER_CONTEXT && this.env.DOCKER_HOST
        ? this.env.DOCKER_HOST
        : await this.json(
            [
              'context',
              'inspect',
              '--format',
              '{{json .Endpoints.docker.Host}}',
            ],
            deadline,
          );
    if (
      endpoint !== 'unix:///var/run/docker.sock' &&
      endpoint !== 'unix:///run/docker.sock'
    )
      throw new Error(
        'Native admission requires a supported local Docker endpoint',
      );
    const daemonId = await this.json(
      ['info', '--format', '{{json .ID}}'],
      deadline,
    );
    if (
      typeof daemonId !== 'string' ||
      !/^[a-zA-Z0-9:._-]{1,128}$/.test(daemonId)
    )
      throw new Error('Native admission daemon identity unavailable');
    const self = await this.inspect(hostname, deadline);
    this.requireRunning(self);
    const [mount, pid, bootRaw] = await Promise.all([
      this.link('/proc/self/ns/mnt'),
      this.link('/proc/self/ns/pid'),
      this.read('/proc/sys/kernel/random/boot_id'),
    ]);
    const boot = bootRaw.trim();
    if (
      !/^mnt:\[\d+\]$/.test(mount) ||
      !/^pid:\[\d+\]$/.test(pid) ||
      !UUID.test(boot)
    )
      throw new Error('Native admission self namespace unavailable');
    // Fixed argv only. No shell, environment or command from a task is used
    // by this identity challenge, and every call after lookup uses full CID.
    const namespaces = await this.output(
      ['exec', self.id, 'readlink', '/proc/self/ns/mnt', '/proc/self/ns/pid'],
      deadline,
    );
    const remoteBoot = await this.output(
      ['exec', self.id, 'cat', '/proc/sys/kernel/random/boot_id'],
      deadline,
    );
    if (namespaces.trim() !== `${mount}\n${pid}` || remoteBoot.trim() !== boot)
      throw new Error(
        'Native admission container is not this process namespace',
      );
    const after = await this.inspect(self.id, deadline);
    this.requireSame(self, after);
    const labels = {
      [`${LABEL}version`]: '1',
      [`${LABEL}daemon`]: daemonId,
      [`${LABEL}boot`]: boot,
      [`${LABEL}container`]: self.id,
      [`${LABEL}started`]: self.startedAt,
      [`${LABEL}generation`]: this.generation,
    };
    const args = [
      'create',
      '--name',
      HOST_ADMISSION_OWNER_NAME,
      '--network',
      'none',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--entrypoint',
      '/bin/false',
    ];
    for (const [key, value] of Object.entries(labels))
      args.push('--label', `${key}=${value}`);
    args.push(self.image);
    // The daemon's atomic name reservation is the conflict boundary. A
    // failure or lost acknowledgement is reconciled ONLY by exact labels;
    // no error text, elapsed lease or absent local PID grants ownership.
    await this.call(args, deadline);
    let owner = await this.inspect(HOST_ADMISSION_OWNER_NAME, deadline);
    if (
      recoverRetired &&
      Object.entries(labels).some(([key, value]) => owner.labels[key] !== value)
    ) {
      await this.retireRecord(owner, daemonId, deadline);
      await this.call(args, deadline);
      owner = await this.inspect(HOST_ADMISSION_OWNER_NAME, deadline);
    }
    if (
      owner.status !== 'created' ||
      owner.running ||
      owner.image !== self.image ||
      Object.entries(labels).some(([key, value]) => owner.labels[key] !== value)
    )
      throw new Error(
        'Native admission authority held by another or unknown incarnation',
      );
    this.requireSame(self, await this.inspect(self.id, deadline));
    this.owned = {
      daemonId,
      hostBootId: boot,
      containerId: self.id,
      imageId: self.image,
      startedAt: self.startedAt,
      generation: this.generation,
      recordId: owner.id,
    };
    return { ...this.owned };
  }

  async assertCurrent(budgetMs = 15_000): Promise<void> {
    const owned = this.owned;
    if (!owned) throw new Error('Native admission authority not acquired');
    // A containing operation may shorten this boundary, never extend it.
    if (!Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 15_000)
      throw new Error('Invalid native admission owner budget');
    const deadline = this.monotonic() + budgetMs;
    const owner = await this.inspect(HOST_ADMISSION_OWNER_NAME, deadline);
    const self = await this.inspect(owned.containerId, deadline);
    this.requireRunning(self);
    const daemon = await this.json(
      ['info', '--format', '{{json .ID}}'],
      deadline,
    );
    if (
      owner.id !== owned.recordId ||
      self.id !== owned.containerId ||
      self.image !== owned.imageId ||
      owner.image !== owned.imageId ||
      daemon !== owned.daemonId ||
      self.startedAt !== owned.startedAt ||
      owner.running ||
      owner.status !== 'created' ||
      owner.labels[`${LABEL}version`] !== '1' ||
      owner.labels[`${LABEL}daemon`] !== owned.daemonId ||
      owner.labels[`${LABEL}boot`] !== owned.hostBootId ||
      owner.labels[`${LABEL}container`] !== owned.containerId ||
      owner.labels[`${LABEL}started`] !== owned.startedAt ||
      owner.labels[`${LABEL}generation`] !== owned.generation
    )
      throw new Error('Native admission authority changed');
  }

  /** A journal may cross generations only when its preserved metadata record
   * proves the exact former writer is stopped/gone. Records are renamed, not
   * deleted, so a crash between name release and acquisition keeps lineage. */
  async assertPriorRetired(identity: HostAdmissionIdentity): Promise<void> {
    const owned = this.owned;
    if (
      !owned ||
      identity.daemonId !== owned.daemonId ||
      !UUID.test(identity.authorityGeneration)
    )
      throw new Error('Native admission recovery identity unavailable');
    const deadline = this.monotonic() + 15_000;
    const raw = await this.output(
      [
        'ps',
        '--all',
        '--no-trunc',
        '--filter',
        `label=${LABEL}version=1`,
        '--filter',
        `label=${LABEL}generation=${identity.authorityGeneration}`,
        '--format',
        '{{.ID}}',
      ],
      deadline,
    );
    const ids = raw.trim().split('\n').filter(Boolean);
    if (ids.length !== 1 || !CID.test(ids[0] ?? ''))
      throw new Error('Native admission recovery lineage unavailable');
    const prior = await this.inspect(ids[0] ?? '', deadline);
    if (
      prior.labels[`${LABEL}boot`] !== identity.hostBootId ||
      prior.labels[`${LABEL}generation`] !== identity.authorityGeneration
    )
      throw new Error('Native admission recovery lineage changed');
    await this.requireRetired(prior, owned.daemonId, deadline);
    await this.assertCurrent(Math.min(15_000, deadline - this.monotonic()));
  }

  private async requireRetired(
    record: Container,
    daemonId: string,
    deadline: number,
  ): Promise<void> {
    const cid = record.labels[`${LABEL}container`];
    const started = record.labels[`${LABEL}started`];
    const generation = record.labels[`${LABEL}generation`];
    const boot = record.labels[`${LABEL}boot`];
    if (
      record.status !== 'created' ||
      record.running ||
      record.labels[`${LABEL}version`] !== '1' ||
      record.labels[`${LABEL}daemon`] !== daemonId ||
      typeof cid !== 'string' ||
      !CID.test(cid) ||
      typeof started !== 'string' ||
      !STARTED.test(started) ||
      typeof generation !== 'string' ||
      !UUID.test(generation) ||
      typeof boot !== 'string' ||
      !UUID.test(boot)
    )
      throw new Error('Native admission prior owner is unknown');
    const raw = await this.output(
      [
        'ps',
        '--all',
        '--no-trunc',
        '--filter',
        `id=${cid}`,
        '--format',
        '{{.ID}}',
      ],
      deadline,
    );
    const ids = raw.trim().split('\n').filter(Boolean);
    if (ids.length === 0) return;
    if (ids.length !== 1 || ids[0] !== cid)
      throw new Error('Native admission prior owner inventory changed');
    const prior = await this.inspect(cid, deadline);
    if (
      prior.id !== cid ||
      prior.image !== record.image ||
      prior.running ||
      (prior.status !== 'exited' && prior.status !== 'dead') ||
      prior.startedAt !== started
    )
      throw new Error(
        'Native admission prior owner is still active or changed',
      );
  }

  private async retireRecord(
    record: Container,
    daemonId: string,
    deadline: number,
  ): Promise<void> {
    await this.requireRetired(record, daemonId, deadline);
    const before = await this.inspect(HOST_ADMISSION_OWNER_NAME, deadline);
    if (JSON.stringify(before) !== JSON.stringify(record))
      throw new Error('Native admission prior record changed');
    const renamed = await this.call(
      [
        'rename',
        record.id,
        `${HOST_ADMISSION_OWNER_NAME}-retired-${record.id}`,
      ],
      deadline,
    );
    if (
      renamed.exitCode !== 0 ||
      renamed.stdoutTruncated ||
      renamed.stderrTruncated
    )
      throw new Error('Native admission prior record retirement is uncertain');
    const after = await this.inspect(record.id, deadline);
    if (JSON.stringify(after) !== JSON.stringify(record))
      throw new Error('Native admission prior record changed');
    await this.requireRetired(after, daemonId, deadline);
  }

  private requireRunning(value: Container): void {
    if (
      !value.running ||
      value.status !== 'running' ||
      !Number.isFinite(Date.parse(value.startedAt)) ||
      Date.parse(value.startedAt) <= 0 ||
      (value.pidMode !== '' && value.pidMode !== 'private')
    )
      throw new Error(
        'Native admission requires a running private PID namespace',
      );
  }

  private requireSame(before: Container, after: Container): void {
    this.requireRunning(after);
    if (
      before.id !== after.id ||
      before.image !== after.image ||
      before.startedAt !== after.startedAt
    )
      throw new Error('Native admission self incarnation changed');
  }

  private async inspect(id: string, deadline: number): Promise<Container> {
    return container(
      await this.json(['inspect', '--format', PROJECTION, id], deadline),
    );
  }

  private async json(args: string[], deadline: number): Promise<unknown> {
    return JSON.parse(await this.output(args, deadline));
  }

  private async output(args: string[], deadline: number): Promise<string> {
    const result = await this.call(args, deadline);
    if (
      result.exitCode !== 0 ||
      result.stdoutTruncated ||
      result.stderrTruncated
    )
      throw new Error('Native admission Docker identity read failed');
    return result.stdout;
  }

  private async call(
    args: string[],
    deadline: number,
  ): Promise<RunDockerResult> {
    const remaining = deadline - this.monotonic();
    if (!Number.isFinite(remaining) || remaining <= 0)
      throw new Error('Native admission owner deadline exceeded');
    const result = await this.docker(args, Math.min(5_000, remaining));
    // A final response has no subsequent call to recheck the common budget.
    // A late create may have taken effect; refuse without removing its record.
    const after = deadline - this.monotonic();
    if (!Number.isFinite(after) || after <= 0)
      throw new Error('Native admission owner deadline exceeded');
    return result;
  }
}
