/**
 * What the burst reads off the host it runs on: the memory the kernel says
 * is available, the OOM kills it made, and what the platform's processes
 * logged. The burst runs on the host that carries the stack and the
 * sandboxes, so `/proc` is the host's.
 */

import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

/** `/proc/meminfo`'s total and available memory, in bytes. */
export function parseMeminfo(
  text: string,
): { totalBytes: number; availableBytes: number } | null {
  const kib = (field: string): number | null => {
    const match = new RegExp(`^${field}:\\s+(\\d+) kB$`, 'm').exec(text);
    return match === null ? null : Number(match[1]) * 1024;
  };
  const totalBytes = kib('MemTotal');
  const availableBytes = kib('MemAvailable');
  return totalBytes === null || availableBytes === null
    ? null
    : { totalBytes, availableBytes };
}

/** `/proc/vmstat`'s count of OOM kills since boot (memory cgroups' too). */
export function parseVmstatOomKills(text: string): number | null {
  const match = /^oom_kill (\d+)$/m.exec(text);
  return match === null ? null : Number(match[1]);
}

/** Seconds since boot, the clock the kernel log stamps its lines with. */
export function parseUptime(text: string): number | null {
  const seconds = Number.parseFloat(text);
  return Number.isFinite(seconds) ? seconds : null;
}

export interface OomKill {
  /** Seconds since boot. */
  atSeconds: number;
  /**
   * `host` when the whole host ran out of memory, `cgroup` when one memory
   * cgroup (a session container) reached its own limit.
   */
  scope: 'host' | 'cgroup';
  pid: number;
  process: string;
  line: string;
}

const KILL_LINE =
  /^\[\s*(\d+\.\d+)\]\s+(.*?)(?:Out of memory|out of memory): Killed process (\d+) \(([^)]*)\)/;

/**
 * The OOM kills in `dmesg` output: one `Killed process` line per kill, the
 * ones of a memory cgroup prefixed `Memory cgroup out of memory:`.
 */
export function parseOomKills(log: string): OomKill[] {
  const kills: OomKill[] = [];
  for (const line of log.split('\n')) {
    const match = KILL_LINE.exec(line);
    if (match === null) continue;
    kills.push({
      atSeconds: Number(match[1]),
      scope: /Memory cgroup\s*$/.test(match[2] ?? '') ? 'cgroup' : 'host',
      pid: Number(match[3]),
      process: match[4] ?? '',
      line: line.trim(),
    });
  }
  return kills;
}

/**
 * The kernel log, or why it is unreadable: `dmesg` needs
 * `kernel.dmesg_restrict=0` (or root) and a host that keeps the ring buffer.
 */
export function readKernelLog(): Promise<
  { ok: true; text: string } | { ok: false; error: string }
> {
  return new Promise((resolve) => {
    execFile(
      'dmesg',
      ['--kernel'],
      { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ ok: true, text: stdout });
          return;
        }
        resolve({
          ok: false,
          error: `${error.message}${stderr.trim() === '' ? '' : `: ${stderr.trim()}`}`,
        });
      },
    );
  });
}

/** A file read as text, or null when it is missing or unreadable. */
export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    console.warn(
      `[burst] cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/** A file's size, so a later scan reads only what was written after it. */
export async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

export interface LogScan {
  path: string;
  /** Lines that matched, by pattern name. */
  counts: Record<string, number>;
  /** The first matching lines, at most `examples` of them. */
  examples: string[];
}

/** The longest example line the report keeps. */
const EXAMPLE_MAX = 400;

/** Count the lines from byte `offset` on that match each named pattern. */
export async function scanLog(
  path: string,
  offset: number,
  patterns: Readonly<Record<string, RegExp>>,
  examples = 5,
): Promise<LogScan> {
  const scan: LogScan = { path, counts: {}, examples: [] };
  for (const name of Object.keys(patterns)) scan.counts[name] = 0;
  if ((await sizeOf(path)) <= offset) return scan;
  const lines = createInterface({
    input: createReadStream(path, { start: offset, encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    let matched = false;
    for (const [name, pattern] of Object.entries(patterns)) {
      if (!pattern.test(line)) continue;
      scan.counts[name] = (scan.counts[name] ?? 0) + 1;
      matched = true;
    }
    if (matched && scan.examples.length < examples) {
      scan.examples.push(line.slice(0, EXAMPLE_MAX));
    }
  }
  return scan;
}
