// Inactive strict probe for the exclusive authority. Existing ordinary probes
// keep their current behavior; no cached positive result is accepted here.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { promisify } from 'node:util';

import { parseMemory } from './capacity.ts';
import type { HostAdmissionReading } from './host-admission-model.ts';
import type { HostAdmissionOwnerIdentity } from './host-admission-owner.ts';
import { runDocker, type RunDockerResult } from './spawn-util.ts';

const exec = promisify(execFile);
const INFO =
  '{"id":{{json .ID}},"kernel":{{json .KernelVersion}},"memory":{{json .MemTotal}},"cpus":{{json .NCPU}},"root":{{json .DockerRootDir}},"runtime":{{json .DefaultRuntime}}}';
const SELF =
  '{"id":{{json .Id}},"hostname":{{json .HostnamePath}},"runtime":{{json .HostConfig.Runtime}},"mounts":{{json .Mounts}}}';
const FILES = [
  '/proc/sys/kernel/random/boot_id',
  '/proc/sys/kernel/osrelease',
  '/proc/meminfo',
  '/proc/loadavg',
  '/proc/pressure/cpu',
  '/proc/pressure/memory',
  '/proc/pressure/io',
  '/sys/devices/system/cpu/online',
] as const;

// Fixed read-only child, no imports from caller cwd, shell or child processes.
// execFile owns its timeout/output bound; an unavailable filesystem never
// produces admission evidence. The parent also checks its final shared clock.
const SAMPLE = `
const fs = require('node:fs');
const path = process.argv[1];
const read = (file) => {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(65537);
    let count = 0;
    while (count < bytes.length) {
      const chunk = fs.readSync(fd, bytes, count, bytes.length - count, null);
      if (chunk === 0) break;
      count += chunk;
    }
    if (count > 65536) throw Error('snapshot too large');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
  } finally { fs.closeSync(fd); }
};
const disk = (file) => {
  if (fs.realpathSync(file) !== file) throw Error('noncanonical snapshot path');
  const before = fs.statSync(file, { bigint: true });
  const value = fs.statfsSync(file, { bigint: true });
  const after = fs.statSync(file, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino) throw Error('snapshot identity changed');
  return { dev: String(before.dev), ino: String(before.ino), type: String(value.type),
    total: String(value.blocks * value.bsize), available: String(value.bavail * value.bsize) };
};
const mounts = read('/proc/self/mountinfo');
const values = ${JSON.stringify(FILES)}.map(read);
const workspace = disk(path);
const metadata = disk('/etc/hostname');
if (read('/proc/self/mountinfo') !== mounts) throw Error('snapshot mounts changed');
console.log(JSON.stringify({ mounts, values, workspace, metadata }));
`;

interface Dependencies {
  docker?: (args: string[], timeoutMs: number) => Promise<RunDockerResult>;
  sample?: (workspace: string, timeoutMs: number) => Promise<string>;
  clock?: () => number;
  monotonic?: () => number;
}

interface Mount {
  id: string;
  device: string;
  root: string;
  path: string;
  type: string;
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid host snapshot object');
  return Object.fromEntries(Object.entries(value));
}

function required(condition: unknown): asserts condition {
  if (!condition) throw new Error('Host admission provenance unavailable');
}

function absolute(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    value.length <= 1024 &&
    !/[\x00-\x1f\x7f]/.test(value) &&
    posix.normalize(value) === value
  );
}

function unsigned(value: unknown): number {
  required(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value));
  const number = Number(value);
  required(Number.isSafeInteger(number) && number >= 0);
  return number;
}

function mounts(raw: unknown): Mount[] {
  required(typeof raw === 'string' && Buffer.byteLength(raw) <= 65_536);
  const rows = raw
    .trimEnd()
    .split('\n')
    .map((line) => {
      const [left, right, extra] = line.split(' - ');
      required(left && right && extra === undefined);
      const fields = left.split(' ');
      const tail = right.split(' ');
      const decode = (value: string | undefined) => {
        required(value !== undefined);
        return value.replace(/\\(040|011|012|134)/g, (_match, octal: string) =>
          String.fromCharCode(Number.parseInt(octal, 8)),
        );
      };
      const id = fields[0];
      const device = fields[2];
      const root = decode(fields[3]);
      const path = decode(fields[4]);
      const type = tail[0];
      required(id && /^\d+$/.test(id) && device && /^\d+:\d+$/.test(device));
      required(
        absolute(root) && absolute(path) && type && /^[a-z0-9_.-]+$/.test(type),
      );
      return { id, device, root, path, type };
    });
  required(rows.length > 0 && rows.length <= 1024);
  required(new Set(rows.map((row) => row.id)).size === rows.length);
  required(new Set(rows.map((row) => row.path)).size === rows.length);
  return rows;
}

function containing(rows: Mount[], path: string): Mount {
  const found = rows
    .filter(
      (row) =>
        path === row.path || path.startsWith(`${row.path.replace(/\/$/, '')}/`),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
  required(found);
  return found;
}

function psi(raw: string | undefined): number {
  required(raw !== undefined && raw.length <= 1024);
  const rows = raw.trimEnd().split('\n');
  required(rows.length >= 1 && rows.length <= 2);
  let some: number | undefined;
  const seen = new Set<string>();
  for (const row of rows) {
    const match =
      /^(some|full) avg10=(\d+\.\d+) avg60=(\d+\.\d+) avg300=(\d+\.\d+) total=(\d+)$/.exec(
        row,
      );
    required(match);
    const kind = match[1];
    required(kind && !seen.has(kind));
    seen.add(kind);
    const values = match.slice(2, 5).map(Number);
    required(
      values.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 100,
      ),
    );
    required(Number.isSafeInteger(Number(match[5])));
    if (match[1] === 'some') some = values[0];
  }
  required(some !== undefined);
  return some;
}

function cpus(raw: string | undefined): number {
  required(raw !== undefined && raw.length <= 4096);
  let total = 0;
  let previous = -1;
  for (const part of raw.trim().split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    required(match);
    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    required(Number.isSafeInteger(first) && Number.isSafeInteger(last));
    required(first > previous && last >= first && last <= 1_048_575);
    total += last - first + 1;
    previous = last;
  }
  required(total > 0);
  return total;
}

function snapshotIdentity(value: Record<string, unknown>): string {
  required(Array.isArray(value.values) && value.values.length === FILES.length);
  const disk = (input: unknown) => {
    const row = object(input);
    return [row.dev, row.ino, row.type, row.total];
  };
  return JSON.stringify([
    value.mounts,
    value.values[0],
    value.values[1],
    value.values[7],
    disk(value.workspace),
    disk(value.metadata),
  ]);
}

/** Requires an already-acquired native owner and trusted boot-owned bind
 * paths. No tool payload can supply these dependencies or claim host scope.
 * V1 deliberately refuses split workspace/Docker filesystems. */
export class HostAdmissionProbe {
  private readonly docker: NonNullable<Dependencies['docker']>;
  private readonly sample: NonNullable<Dependencies['sample']>;
  private readonly clock: () => number;
  private readonly monotonic: () => number;

  constructor(
    private readonly owner: Readonly<HostAdmissionOwnerIdentity>,
    private readonly assertOwner: (budgetMs: number) => Promise<void>,
    private readonly workspace: { hostPath: string; containerPath: string },
    deps: Dependencies = {},
  ) {
    required(absolute(workspace.hostPath) && absolute(workspace.containerPath));
    required(workspace.containerPath !== '/');
    this.docker =
      deps.docker ??
      ((args, timeoutMs) =>
        runDocker(args, {
          timeoutMs,
          priority: true,
          stdoutMaxBytes: 65_536,
          stderrMaxBytes: 1024,
        }));
    this.sample =
      deps.sample ??
      (async (path, timeout) => {
        const result = await exec(process.execPath, ['-e', SAMPLE, path], {
          cwd: '/',
          env: {},
          timeout,
          maxBuffer: 131_072,
          killSignal: 'SIGKILL',
        });
        required(result.stderr === '');
        return result.stdout;
      });
    this.clock = deps.clock ?? Date.now;
    this.monotonic = deps.monotonic ?? (() => performance.now());
  }

  async read(): Promise<HostAdmissionReading> {
    const deadline = this.monotonic() + 20_000;
    const started = this.clock();
    required(Number.isSafeInteger(started) && started > 0);
    const remaining = (cap: number) => {
      const left = deadline - this.monotonic();
      required(Number.isFinite(left) && left > 0);
      return Math.min(cap, left);
    };
    const json = async (args: string[]) => {
      const result = await this.docker(args, remaining(5000));
      remaining(5000);
      required(
        result.exitCode === 0 &&
          !result.stdoutTruncated &&
          !result.stderrTruncated,
      );
      return object(JSON.parse(result.stdout));
    };
    await this.assertOwner(remaining(15_000));
    remaining(5000);
    const info = await json(['info', '--format', INFO]);
    const self = await json([
      'inspect',
      '--format',
      SELF,
      this.owner.containerId,
    ]);
    const raw = await this.sample(
      this.workspace.containerPath,
      remaining(3000),
    );
    remaining(5000);
    required(Buffer.byteLength(raw) <= 131_072);
    const snapshot = object(JSON.parse(raw));
    required(
      Array.isArray(snapshot.values) && snapshot.values.length === FILES.length,
    );
    const values = snapshot.values.map((value: unknown) => {
      required(typeof value === 'string');
      return value;
    });
    required(values[0]?.trim() === this.owner.hostBootId);
    required(
      info.id === this.owner.daemonId && values[1]?.trim() === info.kernel,
    );
    required(
      info.runtime === 'runc' &&
        (self.runtime === '' || self.runtime === 'runc'),
    );
    required(self.id === this.owner.containerId && absolute(info.root));
    const hostname = `${info.root.replace(/\/$/, '')}/containers/${this.owner.containerId}/hostname`;
    required(self.hostname === hostname && Array.isArray(self.mounts));
    const binds = self.mounts
      .map(object)
      .filter((mount) => mount.Destination === this.workspace.containerPath);
    required(
      binds.length === 1 &&
        binds[0]?.Type === 'bind' &&
        binds[0].Source === this.workspace.hostPath,
    );
    const table = mounts(snapshot.mounts);
    const procRoot = containing(table, '/proc');
    const sysRoot = containing(table, '/sys');
    required(
      procRoot.path === '/proc' &&
        procRoot.root === '/' &&
        procRoot.type === 'proc',
    );
    required(
      sysRoot.path === '/sys' &&
        sysRoot.root === '/' &&
        sysRoot.type === 'sysfs',
    );
    for (const path of FILES) {
      const mounted = containing(table, path);
      const proc = path.startsWith('/proc/');
      const base = proc ? procRoot : sysRoot;
      // Only the actual kernel mount is accepted, never an lxcfs/file
      // override or an arbitrary bind of another metric with the same shape.
      // Docker's read-only /proc/sys remount is the same proc device and
      // preserves its kernel path; it is not a substitute metric source.
      required(mounted.type === base.type && mounted.device === base.device);
      required(mounted.root === (mounted.path.slice(base.path.length) || '/'));
    }
    const workMount = containing(table, this.workspace.containerPath);
    const dataMount = containing(table, '/etc/hostname');
    required(
      workMount.path === this.workspace.containerPath &&
        dataMount.path === '/etc/hostname',
    );
    required(
      hostname.endsWith(dataMount.root) &&
        dataMount.root.endsWith(`/${this.owner.containerId}/hostname`),
    );
    required(
      workMount.device === dataMount.device &&
        workMount.type === dataMount.type,
    );
    required(
      workMount.type === 'ext4' ||
        workMount.type === 'xfs' ||
        workMount.type === 'btrfs',
    );
    const work = object(snapshot.workspace);
    const data = object(snapshot.metadata);
    required(work.dev === data.dev && work.type === data.type);
    unsigned(work.dev);
    unsigned(work.ino);
    unsigned(data.ino);
    const total = unsigned(work.total);
    required(total > 0 && total === unsigned(data.total));
    const free = Math.min(unsigned(work.available), unsigned(data.available));
    required(free <= total);
    const memoryRaw = values[2];
    required(
      memoryRaw &&
        [...memoryRaw.matchAll(/^MemTotal:/gm)].length === 1 &&
        [...memoryRaw.matchAll(/^MemAvailable:/gm)].length === 1,
    );
    const memory = parseMemory(memoryRaw);
    required(
      memory &&
        memory.totalBytes === info.memory &&
        Number.isSafeInteger(memory.totalBytes) &&
        Number.isSafeInteger(memory.usedBytes),
    );
    const onlineCpus = cpus(values[7]);
    required(onlineCpus === info.cpus);
    const load = /^(\d+\.\d+) \d+\.\d+ \d+\.\d+ \d+\/\d+ \d+\n?$/.exec(
      values[3] ?? '',
    );
    required(load && Number.isFinite(Number(load[1])));
    const reading: HostAdmissionReading = {
      identity: {
        daemonId: this.owner.daemonId,
        hostBootId: this.owner.hostBootId,
        authorityGeneration: this.owner.generation,
        filesystemId: createHash('sha256')
          .update(
            JSON.stringify({
              boot: this.owner.hostBootId,
              device: workMount.device,
              type: workMount.type,
              workspace: workMount,
              metadata: dataMount,
              dev: work.dev,
            }),
          )
          .digest('hex'),
      },
      observedAt: started,
      onlineCpus,
      load1: Number(load[1]),
      cpuPsi: psi(values[4]),
      memoryPsi: psi(values[5]),
      ioPsi: psi(values[6]),
      memoryTotalBytes: memory.totalBytes,
      memoryAvailableBytes: memory.totalBytes - memory.usedBytes,
      diskAvailableBytes: free,
    };
    required(
      JSON.stringify(await json(['info', '--format', INFO])) ===
        JSON.stringify(info),
    );
    required(
      JSON.stringify(
        await json(['inspect', '--format', SELF, this.owner.containerId]),
      ) === JSON.stringify(self),
    );
    const finalRaw = await this.sample(
      this.workspace.containerPath,
      remaining(3000),
    );
    remaining(1);
    required(Buffer.byteLength(finalRaw) <= 131_072);
    required(
      snapshotIdentity(object(JSON.parse(finalRaw))) ===
        snapshotIdentity(snapshot),
    );
    await this.assertOwner(remaining(15_000));
    remaining(1);
    const ended = this.clock();
    required(
      Number.isSafeInteger(ended) &&
        ended >= started &&
        ended - started < 20_000,
    );
    return reading;
  }
}
