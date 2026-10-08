// TEMPORARY DIAGNOSTIC — never to be merged. Replays the exec-completion
// scenario several times on CI and reports, by failing, how the survivor
// was ended: which signals the manager delivered to it and when, what the
// test itself saw in its /proc entries, and whether a tag scan found it.
import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { EnvStore } from './env-store.ts';
import { ExecManager } from './exec-manager.ts';
import { taggedPids } from './process-reaper.ts';
import type { RunnerdExecEvent } from './protocol.ts';

const root = realpathSync(mkdtempSync(`${tmpdir()}/reaper-diag-`));
process.env.TALE_WORKSPACE_ROOT = root;
const request = { cwd: root, timeoutMs: 30_000, stdoutMaxBytes: 1_000_000, stderrMaxBytes: 1_000_000 };

function running(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch (e) {
    console.warn(e);
    return false;
  }
}
function statusLines(pid: number): string {
  try {
    return readFileSync(`/proc/${pid}/status`, 'utf8')
      .split('\n')
      .filter((l) => /^(State|PPid|SigBlk|SigIgn|SigCgt|Uid|NoNewPrivs|Seccomp):/.test(l))
      .join(' ');
  } catch (e) {
    return `status unreadable: ${String(e)}`;
  }
}
async function environTag(pid: number): Promise<string> {
  try {
    const env = await readFile(`/proc/${pid}/environ`, 'latin1');
    const tag = env.split('\0').find((e) => e.startsWith('TALE_EXEC_ID='));
    return `len=${env.length} tag=${tag ?? 'none'}`;
  } catch (e) {
    return `environ unreadable: ${String(e)}`;
  }
}

test.skipIf(process.platform !== 'linux')('DIAGNOSTIC: how a setsid survivor is ended', async () => {
  const stats: unknown[] = [];
  const envBytes = Object.entries(process.env).reduce((n, [k, v]) => n + k.length + 1 + (v?.length ?? 0) + 1, 0);
  let procCount = '';
  try { procCount = (await readFile('/proc/loadavg', 'utf8')).trim(); } catch (e) { console.warn(e); }
  for (let i = 0; i < 24; i++) {
    const execId = `diag-finished-${i}`;
    const sent: Array<[number, string, number]> = [];
    let t1 = 0;
    using manager = new ExecManager(new EnvStore(), () => {}, () => {}, {
      kill: (pid, signal) => { sent.push([pid, signal, Math.round(performance.now() - t1)]); process.kill(pid, signal); },
    }, { execShim: null });
    const peer = manager.run({ ...request, execId: `diag-peer-${i}`, command: ['sleep', '60'] }, () => {});
    const events: RunnerdExecEvent[] = [];
    const done = manager.run({ ...request, execId, shell: 'setsid sleep 60 </dev/null >/dev/null 2>&1 & echo $!; read release', stdinMode: 'hold' }, (e) => events.push(e));
    let survivor = 0;
    const deadline = performance.now() + 5_000;
    while (!(survivor > 1)) {
      const out = events.filter((e) => e.t === 'stdout').map((e) => Buffer.from(e.b64, 'base64').toString()).join('');
      survivor = Number(out.trim());
      if (performance.now() > deadline) throw new Error(`no survivor pid: ${JSON.stringify(events.slice(0, 4))}`);
      await Bun.sleep(5);
    }
    const t0 = performance.now();
    const seenAtStart = await environTag(survivor);
    const scanAtStart = (await taggedPids(execId)).includes(survivor);
    manager.writeStdin(execId, { b64: Buffer.from('"go"\n').toString('base64'), eof: true });
    await done;
    const seenAfterExit = await environTag(survivor);
    const statusAfterExit = statusLines(survivor);
    manager.cancel(`diag-peer-${i}`);
    await peer;
    t1 = performance.now();
    const seenAtReap = await environTag(survivor);
    const until = t1 + 9_000;
    while (running(survivor) && performance.now() < until) await Bun.sleep(5);
    const endedAfterMs = Math.round(performance.now() - t1);
    const stillRunning = running(survivor);
    const statusAtEnd = statusLines(survivor);
    stats.push({ i, survivor, msToExit: Math.round(t1 - t0), seenAtStart, scanAtStart, seenAfterExit, seenAtReap, statusAfterExit, toSurvivor: sent.filter(([p]) => p === survivor), allSent: sent, endedAfterMs, stillRunning, statusAtEnd });
    await manager.terminateAll();
    await Promise.all([peer, done]);
    try { process.kill(survivor, 'SIGKILL'); } catch (e) { console.warn(e); }
  }
  rmSync(root, { recursive: true, force: true });
  throw new Error(`DIAGNOSTIC bun=${Bun.version} envBytes=${envBytes} loadavg=${procCount} ${JSON.stringify(stats)}`);
}, 180_000);
expect(true).toBe(true);
