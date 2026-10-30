// Pure parsers for the Linux /proc and /sys files the spawner reads about its
// host: CPU counters from /proc/stat, memory from /proc/meminfo, CPU, memory
// and I/O pressure from /proc/pressure/{cpu,memory,io}, the load average from
// /proc/loadavg and the online CPUs from /sys/devices/system/cpu/online. Kept
// apart from the capacity reader, the memory guard and the pressure sampler
// so each can use them without loading the others' dependencies.

export interface CpuCounters {
  total: number;
  idle: number;
  cores: number;
}

/** /proc/stat guest times are already included in user/nice; sum the first
 * eight counters only. I/O wait is idle here. See docs.kernel.org/filesystems/proc.html. */
export function parseCpuCounters(stat: string): CpuCounters | null {
  const line = stat.split('\n').find((entry) => /^cpu\s/.test(entry));
  if (line === undefined) return null;
  const times = line.trim().split(/\s+/).slice(1, 9).map(Number);
  const cores = stat
    .split('\n')
    .filter((entry) => /^cpu\d+\s/.test(entry)).length;
  if (
    times.length < 4 ||
    cores < 1 ||
    times.some((value) => !Number.isFinite(value) || value < 0)
  )
    return null;
  return {
    total: times.reduce((sum, value) => sum + value, 0),
    idle: (times[3] ?? 0) + (times[4] ?? 0),
    cores,
  };
}

/** The busy part of the CPU time between two counters, from 0 to 1; null
 * where they did not move forward or went backwards (a reset). */
export function busyCpuShare(
  before: Pick<CpuCounters, 'total' | 'idle'>,
  after: Pick<CpuCounters, 'total' | 'idle'>,
): number | null {
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  if (total <= 0 || idle < 0 || idle > total) return null;
  return (total - idle) / total;
}

export function usedCpuCores(
  before: CpuCounters | null,
  after: CpuCounters,
): number | null {
  if (before === null || before.cores !== after.cores) return null;
  const share = busyCpuShare(before, after);
  return share === null ? null : share * after.cores;
}

/** MemAvailable includes reclaimable cache; MemFree alone exaggerates usage. */
export function parseMemory(meminfo: string): {
  totalBytes: number;
  usedBytes: number;
} | null {
  const read = (key: string): number | null => {
    const match = meminfo.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB$`, 'm'));
    const bytes = match ? Number(match[1]) * 1024 : Number.NaN;
    return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
  };
  const total = read('MemTotal');
  // Zero available memory is a valid observation, unlike an absent field.
  const availableMatch = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
  const available = availableMatch ? Number(availableMatch[1]) * 1024 : null;
  if (
    total === null ||
    available === null ||
    available < 0 ||
    available > total
  )
    return null;
  return { totalBytes: total, usedBytes: total - available };
}

/** The `some avg10` of a pressure stall file (/proc/pressure/cpu, memory or
 * io): the share of the last ten seconds, in percent, in which at least one
 * task waited for that resource — a CPU, memory it had to reclaim or swap
 * in, or I/O. Null for a file without that line. */
export function parsePressureSomeAvg10(pressure: string): number | null {
  const match = pressure.match(/^some\b.*\bavg10=(\d+(?:\.\d+)?)\b/m);
  if (match === null) return null;
  const percent = Number(match[1]);
  return Number.isFinite(percent) && percent >= 0 && percent <= 100
    ? percent
    : null;
}

/** The one-minute load average of /proc/loadavg (its first field): the
 * runnable and uninterruptible tasks, averaged. Null for a file that does
 * not start with one. */
export function parseLoadAverage(loadavg: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)(?:\s|$)/.exec(loadavg);
  if (match === null) return null;
  const load = Number(match[1]);
  return Number.isFinite(load) && load >= 0 ? load : null;
}

/** How many CPUs /sys/devices/system/cpu/online lists as online: a range
 * list such as `0-3,6` (five CPUs). Null for anything that is not one. */
export function parseOnlineCpus(online: string): number | null {
  const list = online.trim();
  if (list === '') return null;
  let count = 0;
  for (const part of list.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (match === null) return null;
    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) {
      return null;
    }
    if (last < first) return null;
    count += last - first + 1;
  }
  return count > 0 ? count : null;
}
