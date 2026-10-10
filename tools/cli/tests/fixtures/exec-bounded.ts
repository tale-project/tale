import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { boundedOutput } from '../../src/lib/docker/bounded-output';
import { exec } from '../../src/lib/docker/exec';

const mode = process.argv[2];
const scripts: Record<string, string> = {
  stdin:
    'process.stdout.write(await Bun.stdin.text()); console.error("diagnostic"); process.exitCode=7',
  bytes:
    'process.stdout.write("x".repeat(2048)); process.stderr.write("x".repeat(2048)); setInterval(()=>{},1000)',
  timeout: 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)',
};
if (mode === 'descendant') {
  const directory = mkdtempSync(join(tmpdir(), 'tale-bounded-descendant-'));
  const parentFile = join(directory, 'parent');
  const childFile = join(directory, 'child');
  const script = `import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{}); writeFileSync(${JSON.stringify(childFile)},String(process.pid)); setInterval(()=>{},1000)`;
  const proc = Bun.spawn(
    [
      process.execPath,
      '-e',
      `import {writeFileSync} from 'node:fs'; process.on('SIGTERM',()=>{});writeFileSync(${JSON.stringify(parentFile)},String(process.pid)); Bun.spawn([process.execPath,'-e',${JSON.stringify(script)}],{stdout:'inherit',stderr:'inherit'});setInterval(()=>{},1000)`,
    ],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', detached: true },
  );
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  let started: number[] = [];
  let error = '';
  try {
    const deadline = Date.now() + 5000;
    while (
      !(existsSync(parentFile) && existsSync(childFile)) &&
      Date.now() < deadline
    )
      await Bun.sleep(10);
    if (!(existsSync(parentFile) && existsSync(childFile)))
      throw new Error('Descendant readiness deadline exceeded.');
    started = [
      Number(readFileSync(parentFile, 'utf8')),
      Number(readFileSync(childFile, 'utf8')),
    ];
    if (
      started.some(
        (pid) => !Number.isSafeInteger(pid) || pid <= 0 || !alive(pid),
      )
    )
      throw new Error('Descendant was not running.');
    try {
      await boundedOutput(proc, { timeout: 0.25, maxOutputBytes: 3000 });
    } catch (failure) {
      error = (failure as Error).message;
    }
    const deadlineAfter = Date.now() + 2000;
    while (started.some(alive) && Date.now() < deadlineAfter)
      await Bun.sleep(10);
    process.stdout.write(
      JSON.stringify({ error, started, remaining: started.filter(alive) }),
    );
  } finally {
    try {
      process.kill(-proc.pid, 'SIGKILL');
    } catch {}
    await proc.exited;
    rmSync(directory, { recursive: true, force: true });
  }
} else
  try {
    const result = await exec(process.execPath, ['-e', scripts[mode]!], {
      silent: true,
      // Only the timeout probe judges a short deadline. The other probes
      // need room for the nested runtime to start on a busy CI worker.
      timeout: mode === 'timeout' ? 0.25 : 5,
      maxOutputBytes: 3000,
      ...(mode === 'stdin' ? { stdin: 'literal $value\n' } : {}),
    });
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: (error as Error).message }));
  }
