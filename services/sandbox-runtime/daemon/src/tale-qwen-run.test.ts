// tale-qwen-run launch contract. The wrapper exists because two inputs have
// no CLI flag and must be ON DISK before the fork starts (settings via
// QWEN_CODE_SYSTEM_SETTINGS_PATH, the system-prompt append via a per-exec
// context file under ~/.qwen), and because headless yolo must not hang on a
// folder-trust prompt. These drive the real wrapper against a fake `qwen` on
// PATH that records what it was launched with.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WRAPPER = resolve(import.meta.dir, '../../tale-qwen-run');
const hasPython = spawnSync('python3', ['-V']).status === 0;
const pyTest = hasPython ? test : test.skip;

// Fake CLI: record argv, the staged settings, the context files present at
// launch and the prompt read from stdin, then answer in the stream-json
// dialect the platform parses.
const FAKE_QWEN = `#!/bin/sh
{
  printf '{"argv":'
  python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" | tr -d '\\n'
  printf ',"settings":'
  cat "$QWEN_CODE_SYSTEM_SETTINGS_PATH" | tr -d '\\n'
  printf ',"prompt":'
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' | tr -d '\\n'
  printf ',"context":'
  python3 -c 'import json,os,sys; d=os.path.join(os.environ["HOME"],".qwen"); print(json.dumps({n: open(os.path.join(d,n)).read() for n in (os.listdir(d) if os.path.isdir(d) else [])}))' | tr -d '\\n'
  printf ',"yolo_warning":"%s"}\\n' "$QWEN_CODE_SUPPRESS_YOLO_WARNING"
} > "$FAKE_SEEN"
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"fake-session","model":"m"}'
printf '%s\\n' '{"type":"result","subtype":"success","session_id":"fake-session","is_error":false,"result":"done"}'
exit "\${FAKE_EXIT:-0}"
`;

let root: string;
let workspace: string;
let seenPath: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tale-qwen-')));
  workspace = join(root, 'workspace');
  seenPath = join(root, 'seen.json');
  for (const dir of ['workspace', 'bin', 'home', 'tmp']) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  const fake = join(root, 'bin', 'qwen');
  writeFileSync(fake, FAKE_QWEN);
  chmodSync(fake, 0o755);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Seen {
  argv: string[];
  settings: Record<string, unknown>;
  prompt: string;
  context: Record<string, string>;
  yolo_warning: string;
}

function runWrapper(
  payload: Record<string, unknown>,
  extraArgs: string[] = [],
  env: Record<string, string> = {},
) {
  const proc = spawnSync(
    'python3',
    [WRAPPER, '--workdir', workspace, ...extraArgs],
    {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
        HOME: join(root, 'home'),
        TMPDIR: join(root, 'tmp'),
        FAKE_SEEN: seenPath,
        ...env,
      },
    },
  );
  const seen: Seen | null = existsSync(seenPath)
    ? JSON.parse(readFileSync(seenPath, 'utf8'))
    : null;
  const events: Array<Record<string, unknown>> = proc.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line));
  return {
    code: proc.status,
    stdout: proc.stdout,
    stderr: proc.stderr,
    seen,
    events,
  };
}

describe('tale-qwen-run', () => {
  pyTest(
    'launches the fork headless with the staged settings and the prompt on stdin',
    () => {
      const out = runWrapper(
        {
          prompt: 'fix the flaky login test',
          settings: {
            security: { auth: { selectedType: 'openai' } },
            tools: { exclude: ['web_search', 'web_fetch'] },
          },
        },
        [
          '--model',
          'qwen3-coder',
          '--resume',
          'sess-9',
          '--include-directories',
          '/agent/inputs',
        ],
      );

      expect(out.code).toBe(0);
      expect(out.seen?.argv).toEqual([
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--approval-mode',
        'yolo',
        '--model',
        'qwen3-coder',
        '--resume',
        'sess-9',
        '--include-directories',
        '/agent/inputs',
      ]);
      expect(out.seen?.prompt).toBe('fix the flaky login test');
      // The adapter's settings arrive verbatim, plus the headless trust pin.
      expect(out.seen?.settings).toEqual({
        security: {
          auth: { selectedType: 'openai' },
          folderTrust: { enabled: false },
        },
        tools: { exclude: ['web_search', 'web_fetch'] },
      });
      expect(out.seen?.yolo_warning).toBe('1');
      // No system prompt: no context file, no context.fileName override.
      expect(out.seen?.context).toEqual({});
      // The CLI's stream passes through untouched.
      expect(out.events.at(-1)).toMatchObject({
        type: 'result',
        subtype: 'success',
      });
    },
  );

  pyTest(
    'stages the system prompt as a per-exec context file after QWEN.md',
    () => {
      const out = runWrapper({
        prompt: 'hello',
        system_prompt: 'TALE SYSTEM PROMPT',
        settings: { privacy: { usageStatisticsEnabled: false } },
      });

      expect(out.code).toBe(0);
      const names = Object.keys(out.seen?.context ?? {});
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^tale-context-[0-9a-f]{32}\.md$/);
      expect(out.seen?.context[names[0] ?? '']).toBe('TALE SYSTEM PROMPT');
      expect(out.seen?.settings.context).toEqual({
        fileName: ['QWEN.md', names[0]],
      });
      // The per-exec append is gone once the run ends.
      expect(readdirSync(join(root, 'home', '.qwen'))).toEqual([]);
    },
  );

  pyTest('keeps an explicit folder-trust choice from the adapter', () => {
    const out = runWrapper({
      prompt: 'hello',
      settings: { security: { folderTrust: { enabled: true } } },
    });

    expect(out.seen?.settings.security).toEqual({
      folderTrust: { enabled: true },
    });
  });

  pyTest('passes the CLI exit code through', () => {
    const out = runWrapper({ prompt: 'hello' }, [], { FAKE_EXIT: '53' });
    expect(out.code).toBe(53);
  });

  pyTest(
    'refuses a malformed stdin envelope in the stream-json dialect',
    () => {
      const proc = spawnSync('python3', [WRAPPER, '--workdir', workspace], {
        input: 'not json',
        encoding: 'utf8',
        env: { ...process.env, HOME: join(root, 'home') },
      });
      expect(proc.status).toBe(1);
      expect(JSON.parse(proc.stdout.trim())).toMatchObject({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
      });
    },
  );

  pyTest('reports a missing CLI as an errored result', () => {
    // A PATH holding python3 but no `qwen`.
    const python = spawnSync('sh', ['-c', 'command -v python3'], {
      encoding: 'utf8',
    }).stdout.trim();
    const bare = join(root, 'bare-bin');
    mkdirSync(bare);
    symlinkSync(python, join(bare, 'python3'));
    const proc = spawnSync('python3', [WRAPPER, '--workdir', workspace], {
      input: JSON.stringify({ prompt: 'hello' }),
      encoding: 'utf8',
      env: { ...process.env, PATH: bare, HOME: join(root, 'home') },
    });
    expect(proc.status).toBe(1);
    expect(JSON.parse(proc.stdout.trim())).toMatchObject({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
    });
    expect(String(JSON.parse(proc.stdout.trim()).result)).toContain(
      'qwen-code not installed',
    );
  });
});
