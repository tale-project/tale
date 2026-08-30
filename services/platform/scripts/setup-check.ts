#!/usr/bin/env bun
/*
  Pre-flight validation a contributor runs before `bun run dev`.

  `bun run dev` spawns the platform backend, waits for it to bind, then boots
  Vite — a 20-60s chain on a cold machine. When a prerequisite is missing
  (wrong Bun, a port already bound) the failure surfaces deep inside that
  chain with a stack trace, not a sentence. This script front-loads the cheap
  checks and prints a clear pass/fail with the exact remediation, so a missing
  prerequisite is a five-second fix instead of a confusing mid-boot crash.

  It validates:
    - Bun >= 1.3      (the workspace runtime)
    - Port 3000 free  (the Vite dev server binds it)
    - Port 3005 free  (the platform backend binds it)

  The core lives in `runSetupChecks(deps)`, which takes injected probes so a
  unit test can pass fakes and assert on structured results. `main()` wires
  the real probes (a TCP probe mirroring `dev.ts` and the runtime version) and
  renders the output.
*/

import { createConnection } from 'node:net';
import process from 'node:process';

/** A single check's outcome. `ok` gates the exit code; `hard` failures exit
 *  non-zero, soft ones only warn. */
export interface CheckResult {
  name: string;
  ok: boolean;
  /** A hard failure blocks `bun run dev`; a soft one is a warning. */
  hard: boolean;
  /** One line describing what was found (the version, "in use", "missing"). */
  detail: string;
  /** What to run / install to fix it, shown only when `ok` is false. */
  remediation?: string;
}

/** Injected probes. Real implementations live in `main()`; tests pass fakes.
 *
 *  - `portInUse(port)` resolves true when something is already listening.
 *  - `bunVersion` is read from the running runtime (Bun.version), passed in so
 *    the pure function never touches a global. */
export interface SetupCheckDeps {
  bunVersion: string;
  portInUse: (port: number) => Promise<boolean>;
}

const MIN_BUN_MAJOR = 1;
const MIN_BUN_MINOR = 3;
const APP_PORT = 3000;
const BACKEND_PORT = 3005;

/** Parse the leading `x.y.z` out of arbitrary version output. Returns the
 *  numeric major/minor/patch triple, or `null` when nothing parses. */
export function parseSemver(
  raw: string | null,
): { major: number; minor: number; patch: number } | null {
  if (!raw) return null;
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: m[3] ? Number(m[3]) : 0,
  };
}

/** True when `version` is >= the `major.minor` floor (patch ignored). */
function atLeast(
  version: { major: number; minor: number },
  major: number,
  minor: number,
): boolean {
  if (version.major !== major) return version.major > major;
  return version.minor >= minor;
}

function checkBun(bunVersion: string): CheckResult {
  const parsed = parseSemver(bunVersion);
  if (!parsed) {
    return {
      name: 'Bun >= 1.3',
      ok: false,
      hard: true,
      detail: `could not parse Bun version "${bunVersion}"`,
      remediation: 'Install Bun 1.3+: https://bun.sh/docs/installation',
    };
  }
  const ok = atLeast(parsed, MIN_BUN_MAJOR, MIN_BUN_MINOR);
  return {
    name: 'Bun >= 1.3',
    ok,
    hard: true,
    detail: `found ${parsed.major}.${parsed.minor}.${parsed.patch}`,
    remediation: ok
      ? undefined
      : 'Upgrade Bun to 1.3+: run `bun upgrade` (https://bun.sh/docs/installation)',
  };
}

async function checkPort(
  port: number,
  label: string,
  portInUse: SetupCheckDeps['portInUse'],
): Promise<CheckResult> {
  const inUse = await portInUse(port);
  return {
    name: `Port ${port} free (${label})`,
    ok: !inUse,
    hard: true,
    detail: inUse ? 'in use' : 'free',
    remediation: inUse
      ? `Free port ${port} — \`lsof -nP -iTCP:${port} -sTCP:LISTEN\` shows the PID, then \`kill <PID>\`. A leftover \`bun run dev\` / \`tale dev\` is the usual cause.`
      : undefined,
  };
}

/**
 * Run every pre-flight check with the injected probes and return the
 * structured results in display order. Pure: no I/O of its own, no
 * `process.exit`. `main()` (or a test) decides what to do with the array.
 */
export async function runSetupChecks(
  deps: SetupCheckDeps,
): Promise<CheckResult[]> {
  // Bun is synchronous (version is already in hand); the rest run in parallel
  // since they're independent probes.
  const [appPort, backendPort] = await Promise.all([
    checkPort(APP_PORT, 'Vite app', deps.portInUse),
    checkPort(BACKEND_PORT, 'Backend', deps.portInUse),
  ]);
  return [checkBun(deps.bunVersion), appPort, backendPort];
}

/** True when no hard check failed — the gate `main()` uses for its exit code. */
export function allHardChecksPassed(results: CheckResult[]): boolean {
  return results.every((r) => r.ok || !r.hard);
}

/** Render the results as aligned pass/fail lines plus remediation for any
 *  failure. Returned as a string so a test could assert on it without
 *  capturing stdout. */
export function renderResults(results: CheckResult[]): string {
  const lines: string[] = [];
  lines.push('Tale dev pre-flight check');
  lines.push('─────────────────────────');
  for (const r of results) {
    const mark = r.ok ? 'PASS' : r.hard ? 'FAIL' : 'WARN';
    lines.push(`  [${mark}] ${r.name} — ${r.detail}`);
    if (!r.ok && r.remediation) lines.push(`         ↳ ${r.remediation}`);
  }
  lines.push('');
  if (allHardChecksPassed(results)) {
    lines.push('All checks passed. Run `bun run dev` to start the stack.');
  } else {
    lines.push(
      'One or more checks failed. Fix the items above, then re-run `bun run setup:check`.',
    );
  }
  return lines.join('\n');
}

// ── Real probes (used by main(), never imported by the test) ───────────────

/** TCP connect probe — same approach as `dev.ts::tcpProbe`. A successful
 *  connect means something is already listening, so the port is taken. */
function realPortInUse(port: number, timeoutMs = 1_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const results = await runSetupChecks({
    bunVersion: Bun.version,
    portInUse: realPortInUse,
  });
  console.log(renderResults(results));
  process.exit(allHardChecksPassed(results) ? 0 : 1);
}

// Only run main() when invoked directly, so the test can import the pure
// helpers without triggering the probes or process.exit.
if (import.meta.main) {
  main().catch((err) => {
    console.error(
      'setup-check failed unexpectedly:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
