// runnerd's token reaches it on a descriptor, never in its environment, and
// runnerd makes itself non-dumpable before it reads it (runnerd-token.ts).
// What runnerd does with the descriptor and the addon is checked everywhere,
// against stand-ins; what the kernel makes of the addon, against a build of
// daemon/nondumpable/tale-nondumpable.c run by Node, on Linux where a C
// compiler and Node's headers are at hand. A compiler that fails to build the
// addon fails the run.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  type NonDumpable,
  readRunnerdToken,
  runnerdToken,
} from './runnerd-token.ts';

const MODULE = fileURLToPath(new URL('./runnerd-token.ts', import.meta.url));
const SOURCE = fileURLToPath(
  new URL('../nondumpable/tale-nondumpable.c', import.meta.url),
);

/** A stand-in for the addon that records what runnerd asks of it. */
function standIn(calls: string[], clears = true): () => NonDumpable {
  return () => {
    calls.push('load');
    let dumpable = true;
    return {
      setNonDumpable() {
        calls.push('set');
        if (clears) dumpable = false;
      },
      isDumpable() {
        calls.push('is');
        return dumpable;
      },
    };
  };
}

describe("runnerd's token from the environment", () => {
  test('is TALE_RUNNERD_TOKEN, and asks nothing of the addon', () => {
    const calls: string[] = [];
    const nonDumpable = standIn(calls);
    expect(
      readRunnerdToken({ env: { TALE_RUNNERD_TOKEN: 'tok' }, nonDumpable }),
    ).toEqual({ token: 'tok', source: 'environment' });
    expect(
      readRunnerdToken({ env: { TALE_RUNNERD_TOKEN: '' }, nonDumpable }),
    ).toEqual({ token: '', source: 'none' });
    expect(readRunnerdToken({ env: {}, nonDumpable })).toEqual({
      token: '',
      source: 'none',
    });
    expect(calls).toEqual([]);
  });

  test('is read each time it is asked for', () => {
    const env: NodeJS.ProcessEnv = { TALE_RUNNERD_TOKEN: 'one' };
    expect(runnerdToken(env).token).toBe('one');
    env.TALE_RUNNERD_TOKEN = 'two';
    expect(runnerdToken(env).token).toBe('two');
  });
});

describe("runnerd's token from a descriptor", () => {
  test('is read once runnerd is non-dumpable, without its last line break, and the descriptor closed', () => {
    const calls: string[] = [];
    const env: NodeJS.ProcessEnv = {
      TALE_RUNNERD_TOKEN_FD: '9',
      TALE_RUNNERD_TOKEN: 'not this one',
    };
    expect(
      readRunnerdToken({
        env,
        nonDumpable: standIn(calls),
        read: (fd) => {
          calls.push(`read ${fd}`);
          return 'tok\n';
        },
        close: (fd) => {
          calls.push(`close ${fd}`);
        },
      }),
    ).toEqual({ token: 'tok', source: 'descriptor', dumpable: false });
    expect(calls).toEqual(['load', 'set', 'is', 'read 9', 'close 9']);
    // Nothing runnerd starts later is told which descriptor it was.
    expect(env.TALE_RUNNERD_TOKEN_FD).toBeUndefined();
  });

  test('only the last line break is not part of it', () => {
    for (const [text, token] of [
      ['tok', 'tok'],
      ['tok\n\n', 'tok\n'],
      [' tok \n', ' tok '],
    ] as const) {
      expect(
        readRunnerdToken({
          env: { TALE_RUNNERD_TOKEN_FD: '3' },
          nonDumpable: standIn([]),
          read: () => text,
          close: () => {},
        }).token,
      ).toBe(token);
    }
  });

  test('is read from a real descriptor to its end', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runnerd-token-'));
    try {
      writeFileSync(join(dir, 'token'), 'from-a-descriptor\n');
      const fd = openSync(join(dir, 'token'), 'r');
      const closed: number[] = [];
      expect(
        readRunnerdToken({
          env: { TALE_RUNNERD_TOKEN_FD: String(fd) },
          nonDumpable: standIn([]),
          close: (descriptor) => {
            closed.push(descriptor);
            closeSync(descriptor);
          },
        }).token,
      ).toBe('from-a-descriptor');
      expect(closed).toEqual([fd]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test.each(['', 'nine', '9x', '-3', '3.5', '0', '1', '2', '1234567890'])(
    'stops runnerd when the variable names no descriptor it reads (%p)',
    (named) => {
      const calls: string[] = [];
      const env: NodeJS.ProcessEnv = { TALE_RUNNERD_TOKEN_FD: named };
      expect(() =>
        readRunnerdToken({
          env,
          nonDumpable: standIn(calls),
          read: () => 'tok\n',
          close: () => {},
        }),
      ).toThrow('names no descriptor');
      expect(calls).toEqual([]);
      expect(env.TALE_RUNNERD_TOKEN_FD).toBeUndefined();
    },
  );

  test('stops runnerd, unread and closed, when it cannot make itself non-dumpable', () => {
    for (const nonDumpable of [
      () => {
        throw new Error('no such addon');
      },
      () => ({
        setNonDumpable() {
          throw new Error('Operation not permitted');
        },
        isDumpable: () => true,
      }),
      standIn([], false),
    ]) {
      const calls: string[] = [];
      expect(() =>
        readRunnerdToken({
          env: { TALE_RUNNERD_TOKEN_FD: '9' },
          nonDumpable,
          read: () => {
            calls.push('read');
            return 'tok\n';
          },
          close: (fd) => {
            calls.push(`close ${fd}`);
          },
        }),
      ).toThrow();
      expect(calls).toEqual(['close 9']);
    }
  });

  test('stops runnerd when the descriptor cannot be read or holds no token', () => {
    const closed: number[] = [];
    const read = (text: string | Error) =>
      readRunnerdToken({
        env: { TALE_RUNNERD_TOKEN_FD: '9' },
        nonDumpable: standIn([]),
        read: () => {
          if (text instanceof Error) throw text;
          return text;
        },
        close: (fd) => {
          closed.push(fd);
        },
      });
    expect(() => read(new Error('EBADF'))).toThrow(
      'reading the token from descriptor 9 failed',
    );
    expect(() => read('')).toThrow('descriptor 9 held no token');
    expect(() => read('\n')).toThrow('descriptor 9 held no token');
    expect(closed).toEqual([9, 9, 9]);
  });

  test('a failure to read it stays with the process: no fallback to the environment or to none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runnerd-token-kept-'));
    try {
      const script = join(dir, 'kept.ts');
      writeFileSync(
        script,
        `import { runnerdToken } from ${JSON.stringify(MODULE)};
const said: string[] = [];
for (let i = 0; i < 2; i++) {
  try {
    said.push(runnerdToken().source);
  } catch (error) {
    said.push(error instanceof Error ? error.message : String(error));
  }
}
console.log(JSON.stringify(said));
`,
      );
      // A descriptor the child does not hold: whether the image's addon is
      // there or not, the first ask fails.
      const r = spawnSync(process.execPath, [script], {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          TALE_RUNNERD_TOKEN_FD: '999',
          TALE_RUNNERD_TOKEN: 'from-the-environment',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(r.status).toBe(0);
      const said: unknown = JSON.parse(r.stdout);
      expect(Array.isArray(said) && said.length === 2).toBe(true);
      if (!Array.isArray(said)) return;
      expect(said[1]).toBe(said[0]);
      expect(['descriptor', 'environment', 'none']).not.toContain(said[0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Node's headers, where the node on PATH ships them. */
function nodeHeaders(): string | null {
  const node = Bun.which('node');
  if (node === null) return null;
  const headers = join(dirname(dirname(realpathSync(node))), 'include', 'node');
  return existsSync(join(headers, 'node_api.h')) ? headers : null;
}

const WORK = mkdtempSync(join(tmpdir(), 'runnerd-nondumpable-'));
afterAll(() => {
  rmSync(WORK, { recursive: true, force: true });
});

/** The addon built for this run, or null where it cannot be: not Linux, no
 * Node with its headers, or no C compiler. */
function buildAddon(): string | null {
  if (process.platform !== 'linux') return null;
  const headers = nodeHeaders();
  if (headers === null) return null;
  const out = join(WORK, 'tale-nondumpable.node');
  const built = spawnSync('cc', [
    '-O2',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-shared',
    '-fPIC',
    `-I${headers}`,
    '-o',
    out,
    SOURCE,
  ]);
  if (built.error !== undefined) {
    if ('code' in built.error && built.error.code === 'ENOENT') return null;
    throw built.error;
  }
  if (built.status !== 0) {
    throw new Error(`building the addon failed:\n${String(built.stderr)}`);
  }
  return out;
}

const ADDON = buildAddon();

/** Whether this process may open `path`; false for a refusal by the kernel's
 * ptrace check, which /proc answers with EACCES or EPERM. */
function opens(path: string, read: (path: string) => unknown): boolean {
  try {
    read(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'EACCES' || error.code === 'EPERM')
    )
      return false;
    throw error;
  }
}

// Root passes the kernel's ptrace check whatever the flag says.
const AS_ROOT = process.getuid?.() === 0;

describe('the non-dumpable addon', () => {
  test.skipIf(ADDON === null || AS_ROOT)(
    'keeps every other process of its uid out of runnerd once it read its token',
    async () => {
      if (ADDON === null) return;
      // Run by Node, as runnerd is: the module bundled for it, as in the image.
      const bundle = await Bun.build({
        entrypoints: [MODULE],
        target: 'node',
        outdir: WORK,
      });
      expect(bundle.success).toBe(true);
      writeFileSync(join(WORK, 'token'), 'probe-token\n');
      const probe = join(WORK, 'probe.mjs');
      writeFileSync(
        probe,
        `import { openSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { loadNonDumpable, readRunnerdToken } from './runnerd-token.js';
const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const addon = loadNonDumpable(process.argv[2]);
console.log(JSON.stringify({ dumpable: addon.isDumpable() }));
await lines.next();
const fd = openSync(process.argv[3], 'r');
process.env.TALE_RUNNERD_TOKEN_FD = String(fd);
const got = readRunnerdToken({ nonDumpable: () => addon });
console.log(JSON.stringify({
  ...got,
  stillDumpable: addon.isDumpable(),
  named: process.env.TALE_RUNNERD_TOKEN_FD ?? null,
  open: existsSync('/proc/self/fd/' + fd),
}));
await lines.next();
`,
      );
      const child = spawn('node', [probe, ADDON, join(WORK, 'token')], {
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          PROBE_MARK: 'readable-by-its-uid',
        },
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      const said = createInterface({ input: child.stdout })[
        Symbol.asyncIterator
      ]();
      const next = async (): Promise<unknown> => {
        const line = await said.next();
        if (line.done === true) throw new Error('the probe ended early');
        return JSON.parse(line.value);
      };
      try {
        const proc = `/proc/${child.pid}`;
        expect(await next()).toEqual({ dumpable: true });
        // Dumpable, its environment is open to its uid: the issue's probe.
        expect(readFileSync(`${proc}/environ`, 'utf8')).toContain(
          'PROBE_MARK=readable-by-its-uid',
        );
        child.stdin.write('\n');
        expect(await next()).toEqual({
          token: 'probe-token',
          source: 'descriptor',
          dumpable: false,
          stillDumpable: false,
          named: null,
          open: false,
        });
        // Its environment, memory and descriptors are closed to its uid now.
        expect(opens(`${proc}/environ`, (path) => readFileSync(path))).toBe(
          false,
        );
        expect(
          opens(`${proc}/mem`, (path) => closeSync(openSync(path, 'r'))),
        ).toBe(false);
        expect(opens(`${proc}/fd`, (path) => readdirSync(path))).toBe(false);
      } finally {
        child.stdin.end();
        child.kill();
      }
    },
    20_000,
  );
});
