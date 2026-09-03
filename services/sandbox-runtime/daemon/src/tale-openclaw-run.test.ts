// tale-openclaw-run AGENTS.md safety. The system prompt rides the workspace
// AGENTS.md bootstrap file (the only channel the pinned CLI reads it from), so
// the wrapper must hand the user's own AGENTS.md back on EVERY exit path: a
// clean run, runnerd's cancel (a process-group SIGTERM, then SIGKILL after a
// 5s grace) and a hard SIGKILL (grace expired, container teardown). These
// cases drive the real wrapper against a fake `openclaw` on PATH and signal
// its process group exactly as runnerd's exec-manager does.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WRAPPER = resolve(import.meta.dir, '../../tale-openclaw-run');
const hasPython = spawnSync('python3', ['-V']).status === 0;
const pyTest = hasPython ? test : test.skip;

const ORIGINAL = '# My repo rules\n\nKeep it tidy.\n';
const PROMPT_V1 = 'TALE SYSTEM PROMPT v1';
const PROMPT_V2 = 'TALE SYSTEM PROMPT v2';

// Fake CLI: record the AGENTS.md OpenClaw would load, then either answer with
// a final `--json` envelope (`ok`) or hang like a long agent turn (`hang`).
const FAKE_OPENCLAW = `#!/bin/sh
if [ -f "$FAKE_WORKSPACE/AGENTS.md" ]; then
  cat "$FAKE_WORKSPACE/AGENTS.md" > "$FAKE_SEEN"
else
  printf '<absent>' > "$FAKE_SEEN"
fi
if [ "$FAKE_MODE" = "hang" ]; then sleep 60; exit 0; fi
printf '%s' '{"payloads":[{"text":"hi"}],"meta":{"durationMs":1,"agentMeta":{"sessionId":"s","model":"m","usage":{"input":1,"output":1}}}}'
`;

let root: string;
let workspace: string;
let seenPath: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tale-openclaw-')));
  workspace = join(root, 'workspace');
  seenPath = join(root, 'seen.txt');
  for (const d of ['workspace', 'bin', 'home', 'state', 'tmp']) {
    mkdirSync(join(root, d), { recursive: true });
  }
  const fake = join(root, 'bin', 'openclaw');
  writeFileSync(fake, FAKE_OPENCLAW);
  chmodSync(fake, 0o755);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface RunResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

function startWrapper(opts: { mode: 'ok' | 'hang'; systemPrompt?: string }) {
  const payload: Record<string, unknown> = {
    prompt: 'hello',
    config: { agents: { defaults: { workspace } } },
  };
  if (opts.systemPrompt !== undefined)
    payload.system_prompt = opts.systemPrompt;
  rmSync(seenPath, { force: true });
  const child = spawn('python3', [WRAPPER, '--workdir', workspace], {
    // Own process group — exactly how runnerd spawns an exec, so a group
    // signal reaches the wrapper AND the CLI it launched.
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      HOME: join(root, 'home'),
      TMPDIR: join(root, 'tmp'),
      OPENCLAW_STATE_DIR: join(root, 'state'),
      FAKE_WORKSPACE: workspace,
      FAKE_SEEN: seenPath,
      FAKE_MODE: opts.mode,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d: Buffer) => {
    stdout += d.toString();
  });
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString();
  });
  const done = new Promise<RunResult>((r) => {
    child.on('close', (code, signal) => r({ code, signal, stdout, stderr }));
  });
  child.stdin.end(JSON.stringify(payload));
  const killGroup = (sig: NodeJS.Signals) => {
    if (child.pid !== undefined) process.kill(-child.pid, sig);
  };
  return { done, killGroup };
}

/** Wait until the fake CLI has started (it records AGENTS.md first thing). */
async function waitForSeen(): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (existsSync(seenPath)) return readFileSync(seenPath, 'utf8');
    await Bun.sleep(20);
  }
  throw new Error('fake openclaw never started');
}

const agentsMd = (): string | null => {
  const p = join(workspace, 'AGENTS.md');
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};

/** Every regular file under `dir` whose content is exactly `content`. */
function filesWithContent(dir: string, content: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesWithContent(p, content));
    else if (e.isFile() && readFileSync(p, 'utf8') === content) out.push(p);
  }
  return out;
}

describe('tale-openclaw-run AGENTS.md safety', () => {
  pyTest(
    'clean run: the CLI sees the system prompt, the user file comes back',
    async () => {
      writeFileSync(join(workspace, 'AGENTS.md'), ORIGINAL);

      const res = await startWrapper({ mode: 'ok', systemPrompt: PROMPT_V1 })
        .done;

      expect(res.code).toBe(0);
      expect(readFileSync(seenPath, 'utf8')).toBe(PROMPT_V1);
      expect(agentsMd()).toBe(ORIGINAL);
      expect(res.stdout).toContain('"type": "run_end"');
      // No parked copy lingers after a clean turn.
      expect(filesWithContent(root, ORIGINAL)).toEqual([
        join(workspace, 'AGENTS.md'),
      ]);
    },
  );

  pyTest('without a system prompt the user file is never touched', async () => {
    writeFileSync(join(workspace, 'AGENTS.md'), ORIGINAL);

    const res = await startWrapper({ mode: 'ok' }).done;

    expect(res.code).toBe(0);
    expect(readFileSync(seenPath, 'utf8')).toBe(ORIGINAL);
    expect(agentsMd()).toBe(ORIGINAL);
  });

  pyTest(
    'cancel (process-group SIGTERM) mid-turn restores the user file before exit',
    async () => {
      writeFileSync(join(workspace, 'AGENTS.md'), ORIGINAL);
      const run = startWrapper({ mode: 'hang', systemPrompt: PROMPT_V1 });
      expect(await waitForSeen()).toBe(PROMPT_V1);

      run.killGroup('SIGTERM');
      const res = await run.done;

      expect(res.code).not.toBe(0);
      expect(agentsMd()).toBe(ORIGINAL);
      // A cancel is reported as such — a user Stop is not a failure.
      expect(res.stdout).toContain('"type": "run_end", "status": "cancelled"');
    },
  );

  pyTest(
    'SIGKILL mid-turn never loses the user file; the next turn restores it',
    async () => {
      writeFileSync(join(workspace, 'AGENTS.md'), ORIGINAL);
      const run = startWrapper({ mode: 'hang', systemPrompt: PROMPT_V1 });
      expect(await waitForSeen()).toBe(PROMPT_V1);

      run.killGroup('SIGKILL');
      await run.done;

      // The original survives the kill on disk …
      expect(filesWithContent(root, ORIGINAL).length).toBeGreaterThan(0);
      // … and the next wrapper start puts it back BEFORE staging its own prompt,
      // so the new prompt still reaches the CLI and the user file wins at the end.
      const res = await startWrapper({ mode: 'ok', systemPrompt: PROMPT_V2 })
        .done;
      expect(res.code).toBe(0);
      expect(readFileSync(seenPath, 'utf8')).toBe(PROMPT_V2);
      expect(agentsMd()).toBe(ORIGINAL);
    },
  );

  pyTest(
    'SIGKILL with no user file leaves no stale prompt after the next turn',
    async () => {
      const run = startWrapper({ mode: 'hang', systemPrompt: PROMPT_V1 });
      expect(await waitForSeen()).toBe(PROMPT_V1);

      run.killGroup('SIGKILL');
      await run.done;

      const res = await startWrapper({ mode: 'ok', systemPrompt: PROMPT_V2 })
        .done;
      expect(res.code).toBe(0);
      expect(readFileSync(seenPath, 'utf8')).toBe(PROMPT_V2);
      expect(agentsMd()).toBeNull();
    },
  );
});
