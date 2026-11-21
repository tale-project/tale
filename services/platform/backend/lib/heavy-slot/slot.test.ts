import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  memoryLimitOf,
  memoryLimitSentence,
} from '../../../lib/shared/memory-limit.ts';
import {
  childEnvironment,
  childHeapFlags,
  configureHeavySlot,
  DEFAULT_HEAVY_SLOT_MEMORY_MB,
  DEFAULT_HEAVY_SLOTS,
  HEAVY_SLOT_MEMORY_VARIABLE,
  HeavyLimitError,
  heavySlotLoad,
  heavySlotSettings,
  runCommand,
  runNodeChild,
  withHeavySlot,
} from './slot.ts';

afterEach(() => {
  vi.restoreAllMocks();
  configureHeavySlot({
    slots: DEFAULT_HEAVY_SLOTS,
    memoryMb: DEFAULT_HEAVY_SLOT_MEMORY_MB,
  });
});

/** A job that holds its slot until it is let go. */
function gate(): { held: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { held, release };
}

/** Let everything that is ready to run, run. */
const settle = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

describe('the heavy slot runs one job at a time', () => {
  it('is one slot of 512 MiB unless told otherwise', () => {
    expect(heavySlotSettings()).toEqual({ slots: 1, memoryMb: 512 });
  });

  it('makes the second job wait for the first, and the third for the second [KNOW-R23]', async () => {
    const order: string[] = [];
    const first = gate();
    const second = gate();
    const jobs = [
      withHeavySlot({ priority: 'background' }, async () => {
        order.push('first starts');
        await first.held;
        order.push('first ends');
      }),
      withHeavySlot({ priority: 'background' }, async () => {
        order.push('second starts');
        await second.held;
        order.push('second ends');
      }),
      withHeavySlot({ priority: 'background' }, () => {
        order.push('third runs');
        return Promise.resolve();
      }),
    ];
    await settle();
    expect(order).toEqual(['first starts']);
    expect(heavySlotLoad()).toEqual({ running: 1, waiting: 2 });

    first.release();
    await settle();
    expect(order).toEqual(['first starts', 'first ends', 'second starts']);

    second.release();
    await Promise.all(jobs);
    expect(order).toEqual([
      'first starts',
      'first ends',
      'second starts',
      'second ends',
      'third runs',
    ]);
    expect(heavySlotLoad()).toEqual({ running: 0, waiting: 0 });
  });

  it('answers what the job answers', async () => {
    await expect(
      withHeavySlot({ priority: 'interactive' }, () => Promise.resolve(42)),
    ).resolves.toBe(42);
  });

  it('gives the slot back when the job fails', async () => {
    await expect(
      withHeavySlot({ priority: 'background' }, () =>
        Promise.reject(new Error('the job failed')),
      ),
    ).rejects.toThrow('the job failed');
    expect(heavySlotLoad()).toEqual({ running: 0, waiting: 0 });
    await expect(
      withHeavySlot({ priority: 'background' }, () => Promise.resolve('next')),
    ).resolves.toBe('next');
  });

  it('serves work a person waits for ahead of work a queue brought, each in its own order [KNOW-R23]', async () => {
    const order: string[] = [];
    const first = gate();
    const run = (name: string, priority: 'interactive' | 'background') =>
      withHeavySlot({ priority }, () => {
        order.push(name);
        return Promise.resolve();
      });
    const holder = withHeavySlot({ priority: 'background' }, () => first.held);
    await settle();
    const waiting = [
      run('index a', 'background'),
      run('read a', 'interactive'),
      run('index b', 'background'),
      run('read b', 'interactive'),
    ];
    await settle();
    expect(order).toEqual([]);

    first.release();
    await Promise.all([holder, ...waiting]);
    expect(order).toEqual(['read a', 'read b', 'index a', 'index b']);
  });

  // Every upload is read for whoever uploaded it: while uploads keep
  // coming, such a job is always in line. Going first every time, they held
  // a document's index back until its own job gave up on it.
  it('gives work a queue brought every fifth turn while work a person waits for keeps coming [KNOW-R23]', async () => {
    const order: string[] = [];
    const first = gate();
    const run = (name: string, priority: 'interactive' | 'background') =>
      withHeavySlot({ priority }, () => {
        order.push(name);
        return Promise.resolve();
      });
    const holder = withHeavySlot({ priority: 'background' }, () => first.held);
    await settle();
    const waiting = [
      run('index a', 'background'),
      run('index b', 'background'),
      ...Array.from({ length: 11 }, (_read, at) =>
        run(`read ${at + 1}`, 'interactive'),
      ),
    ];
    await settle();
    first.release();
    await Promise.all([holder, ...waiting]);
    expect(order).toEqual([
      'read 1',
      'read 2',
      'read 3',
      'read 4',
      'index a',
      'read 5',
      'read 6',
      'read 7',
      'read 8',
      'index b',
      'read 9',
      'read 10',
      'read 11',
    ]);
  });

  // The turns counted are those taken past a queued job that waits. Work a
  // person waits for that came while nothing was queued does not count
  // against the next such work.
  it('counts only the turns that went past queued work', async () => {
    const order: string[] = [];
    const first = gate();
    const second = gate();
    const run = (name: string, priority: 'interactive' | 'background') =>
      withHeavySlot({ priority }, () => {
        order.push(name);
        return Promise.resolve();
      });
    const holder = withHeavySlot({ priority: 'background' }, () => first.held);
    await settle();
    const early = [
      ...Array.from({ length: 4 }, (_read, at) =>
        run(`read ${at + 1}`, 'interactive'),
      ),
      withHeavySlot({ priority: 'interactive' }, () => second.held),
    ];
    await settle();
    first.release();
    await settle();
    expect(order).toEqual(['read 1', 'read 2', 'read 3', 'read 4']);
    // Five jobs a person waited for have gone, past nothing. A queued job
    // that comes now is passed four times, like any other.
    const late = [
      run('index a', 'background'),
      ...Array.from({ length: 6 }, (_read, at) =>
        run(`read ${at + 5}`, 'interactive'),
      ),
    ];
    await settle();
    second.release();
    await Promise.all([holder, ...early, ...late]);
    expect(order.slice(4)).toEqual([
      'read 5',
      'read 6',
      'read 7',
      'read 8',
      'index a',
      'read 9',
      'read 10',
    ]);
  });

  it('lets a job that gives up leave the line, with its reason, and serves the others', async () => {
    const first = gate();
    const holder = withHeavySlot({ priority: 'background' }, () => first.held);
    await settle();
    const caller = new AbortController();
    let ran = false;
    const gaveUp = withHeavySlot(
      { priority: 'background', signal: caller.signal },
      () => {
        ran = true;
        return Promise.resolve();
      },
    );
    const patient = withHeavySlot({ priority: 'background' }, () =>
      Promise.resolve('served'),
    );
    await settle();
    expect(heavySlotLoad()).toEqual({ running: 1, waiting: 2 });

    caller.abort(new Error('the job was cancelled'));
    await expect(gaveUp).rejects.toThrow('the job was cancelled');
    expect(heavySlotLoad()).toEqual({ running: 1, waiting: 1 });

    first.release();
    await holder;
    await expect(patient).resolves.toBe('served');
    expect(ran).toBe(false);
  });

  it('does not start a job whose caller had given up already', async () => {
    let ran = false;
    await expect(
      withHeavySlot(
        {
          priority: 'background',
          signal: AbortSignal.abort(new Error('too late')),
        },
        () => {
          ran = true;
          return Promise.resolve();
        },
      ),
    ).rejects.toThrow('too late');
    expect(ran).toBe(false);
    expect(heavySlotLoad()).toEqual({ running: 0, waiting: 0 });
  });

  it('runs as many at once as it has slots', async () => {
    configureHeavySlot({ slots: 2 });
    const first = gate();
    const second = gate();
    let third = false;
    const jobs = [
      withHeavySlot({ priority: 'background' }, () => first.held),
      withHeavySlot({ priority: 'background' }, () => second.held),
      withHeavySlot({ priority: 'background' }, () => {
        third = true;
        return Promise.resolve();
      }),
    ];
    await settle();
    expect(heavySlotLoad()).toEqual({ running: 2, waiting: 1 });
    expect(third).toBe(false);

    second.release();
    await settle();
    expect(third).toBe(true);
    first.release();
    await Promise.all(jobs);
  });
});

describe('the error of a job that needed more than its cap', () => {
  // Every lane stores this error's message as its failure, and the app
  // reads the limit back out of it to say the same in another language.
  it('says the sentence the app recognises, and names the setting the backend reads', () => {
    const error = new HeavyLimitError(96);
    expect(error.message).toBe(memoryLimitSentence(96));
    expect(memoryLimitOf(error.message)).toBe(96);
    expect(error.message).toContain(HEAVY_SLOT_MEMORY_VARIABLE);
    expect(error.code).toBe('HEAVY_SLOT_MEMORY_LIMIT');
    expect(error.limitMb).toBe(96);
  });
});

describe('what a child is started with', () => {
  it('gives the heap three fifths of the cap, and a small young generation under a small cap', () => {
    expect(childHeapFlags(96)).toEqual([
      '--max-old-space-size=57',
      '--max-semi-space-size=1',
      '--expose-gc',
    ]);
    expect(childHeapFlags(512)).toEqual([
      '--max-old-space-size=307',
      '--max-semi-space-size=8',
      '--expose-gc',
    ]);
  });

  it('never gives the heap less than a reader needs to start', () => {
    expect(childHeapFlags(40)[0]).toBe('--max-old-space-size=32');
  });

  it('hands on where its program and its patterns are, and no secret', () => {
    const env = childEnvironment({
      PATH: '/usr/bin',
      TZ: 'Europe/Zurich',
      TALE_CONFIG_SYSTEM_DIR: '/app/configs/system',
      DATABASE_URL: 'postgres://tale:secret@db/tale',
      BETTER_AUTH_SECRET: 'a-secret-of-the-backend',
      INSTANCE_SECRET: 'another',
      S3_SECRET_ACCESS_KEY: 'and-another',
      NODE_OPTIONS: '--max-old-space-size=4096',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      TZ: 'Europe/Zurich',
      TALE_CONFIG_SYSTEM_DIR: '/app/configs/system',
      MALLOC_ARENA_MAX: '2',
    });
  });

  it('keeps few memory arenas, or as many as this process was started with', () => {
    expect(childEnvironment({}).MALLOC_ARENA_MAX).toBe('2');
    expect(childEnvironment({ MALLOC_ARENA_MAX: '4' }).MALLOC_ARENA_MAX).toBe(
      '4',
    );
  });
});

describe('a child the slot runs', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'heavy-slot-child-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** A program for a child: plain JavaScript, so that it starts as fast as
   * a child can. */
  function program(name: string, body: string): URL {
    const file = path.join(dir, `${name}.mjs`);
    writeFileSync(file, body);
    return pathToFileURL(file);
  }

  const ANSWERS = `
    process.once('message', (request) => {
      process.send({ got: request, pid: process.pid }, () => process.exit(0));
    });
    process.send({ ready: true });
  `;

  it('is sent its request once it is ready, and answers', async () => {
    const answer = await runNodeChild(
      program('answers', ANSWERS),
      { op: 'extract', fileName: 'a.txt' },
      { label: 'reading a .txt file' },
    );
    expect(answer).toMatchObject({
      got: { op: 'extract', fileName: 'a.txt' },
    });
    expect(answer).not.toMatchObject({ pid: process.pid });
  });

  it('is given the heap limit of its cap', async () => {
    const flags = await runNodeChild(
      program(
        'flags',
        `process.once('message', () => {
           process.send({ execArgv: process.execArgv, gc: typeof globalThis.gc }, () => process.exit(0));
         });
         process.send({ ready: true });`,
      ),
      {},
      { label: 'flags', memoryMb: 200 },
    );
    expect(flags).toMatchObject({
      execArgv: expect.arrayContaining([
        '--max-old-space-size=120',
        '--max-semi-space-size=1',
        '--expose-gc',
      ]),
      gc: 'function',
    });
  });

  it("is given none of this process's secrets", async () => {
    process.env.HEAVY_SLOT_TEST_SECRET = 'not for a child';
    try {
      const answer = await runNodeChild(
        program(
          'env',
          `process.once('message', () => {
             process.send({ keys: Object.keys(process.env) }, () => process.exit(0));
           });
           process.send({ ready: true });`,
        ),
        {},
        { label: 'env' },
      );
      expect(answer).toMatchObject({
        keys: expect.not.arrayContaining(['HEAVY_SLOT_TEST_SECRET']),
      });
    } finally {
      delete process.env.HEAVY_SLOT_TEST_SECRET;
    }
  });

  it('fails its job when it stops without an answer, and says how it stopped', async () => {
    await expect(
      runNodeChild(
        program(
          'dies',
          `process.once('message', () => {
             console.error('something inside went wrong');
             process.exit(3);
           });
           process.send({ ready: true });`,
        ),
        {},
        { label: 'reading a .pdf file' },
      ),
    ).rejects.toThrow(
      'reading a .pdf file stopped before it answered (exit code 3: something inside went wrong)',
    );
  });

  it('is stopped when its job runs out of time', async () => {
    await expect(
      runNodeChild(
        program(
          'hangs',
          `process.once('message', () => setInterval(() => {}, 1000));
           process.send({ ready: true });`,
        ),
        {},
        { label: 'reading a .pdf file', timeoutMs: 300 },
      ),
    ).rejects.toThrow(
      'reading a .pdf file timed out: it took longer than the 1 s it is given',
    );
  });

  it("is stopped when its caller gives up, with the caller's reason", async () => {
    const caller = new AbortController();
    const job = runNodeChild(
      program(
        'waits',
        `process.once('message', () => setInterval(() => {}, 1000));
         process.send({ ready: true });`,
      ),
      {},
      { label: 'waits', signal: caller.signal },
    );
    setTimeout(() => caller.abort(new Error('the job was cancelled')), 150);
    await expect(job).rejects.toThrow('the job was cancelled');
  });

  // The watch reads the child's memory from /proc, which is Linux's.
  it.runIf(process.platform === 'linux')(
    'is killed when it holds more than its cap, and its job fails with the limit',
    async () => {
      const job = runNodeChild(
        program(
          'hoards',
          // Buffers are outside the V8 heap: only the watch stops this. At
          // ten times its cap the child gives up by itself, so that a watch
          // that missed it fails this test, where a child without an end
          // would fill the machine.
          `const kept = [];
           process.once('message', () => {
             setInterval(() => {
               kept.push(Buffer.alloc(8 * 1024 * 1024, 1));
               if (kept.length === 128) process.exit(0);
             }, 10);
           });
           process.send({ ready: true });`,
        ),
        {},
        { label: 'hoards', memoryMb: 96, watchIntervalMs: 20 },
      );
      await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
      await expect(job).rejects.toMatchObject({
        limitMb: 96,
        message:
          'This file needs more memory than the 96 MiB this server gives one file. An administrator can raise the limit with HEAVY_SLOT_MEMORY_MB.',
      });
    },
  );

  it('fails its job with the limit when V8 stops it at its heap limit [KNOW-R22]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const passedOn = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const job = runNodeChild(
      program(
        'fills-the-heap',
        `const kept = [];
         process.once('message', () => {
           console.error('reading the file');
           for (;;) kept.push(new Array(1000).fill({ a: 1 }).map((x, i) => ({ i })));
         });
         process.send({ ready: true });`,
      ),
      {},
      // A watch that sees nothing: V8's own limit is what stops it.
      { label: 'reading a .csv file', memoryMb: 64, readMemory: () => 0 },
    );
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    await expect(job).rejects.toMatchObject({ limitMb: 64 });
    const written = passedOn.mock.calls
      .map(([chunk]) => String(chunk))
      .join('');
    passedOn.mockRestore();

    // One line for whoever runs the deployment: the job, the cap, the
    // variable that raises it.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[heavy-slot] reading a .csv file needed more than the 64 MiB one file is given and was stopped; HEAVY_SLOT_MEMORY_MB raises the limit',
    );
    // What the child logged is this process's log; V8's thirty lines about
    // its collections and its native stack are not.
    expect(written).toContain('reading the file');
    expect(written).not.toContain('Last few GCs');
    expect(written).not.toContain('Native stack trace');
    expect(written).not.toContain('FATAL ERROR');
  });

  // V8 writes its report in several goes, and a pipe hands them on as they
  // come: what is passed on stops at the report's first line, however many
  // pieces follow it.
  it('passes on nothing of a heap report that arrives in pieces', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const passedOn = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const job = runNodeChild(
      program(
        'reports-in-pieces',
        `process.once('message', () => {
           process.stderr.write('reading the file\\n<--- Last few GCs --->\\n');
           setTimeout(() => {
             process.stderr.write('[1:0x1] 90 ms: Mark-Compact 37.6 (38.6) -> 37.1 MB\\n');
           }, 40);
           setTimeout(() => {
             process.stderr.write('FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\\n');
             process.stderr.write('----- Native stack trace -----\\n', () => process.exit(134));
           }, 80);
         });
         process.send({ ready: true });`,
      ),
      {},
      { label: 'reading a .csv file', memoryMb: 64, readMemory: () => 0 },
    );
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    const written = passedOn.mock.calls
      .map(([chunk]) => String(chunk))
      .join('');
    passedOn.mockRestore();
    expect(written).toBe('reading the file\n');
  });

  // Node opens every fatal error with the same two words: only the ones
  // that speak of memory are a document that needs more of it.
  it('does not take another fatal error for the memory limit', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const job = runNodeChild(
      program(
        'fatal-otherwise',
        `process.once('message', () => {
           process.stderr.write('FATAL ERROR: v8::ToLocalChecked Empty MaybeLocal\\n', () => process.exit(1));
         });
         process.send({ ready: true });`,
      ),
      {},
      { label: 'reading a .pdf file', memoryMb: 64, readMemory: () => 0 },
    );
    await expect(job).rejects.toThrow(
      'reading a .pdf file stopped before it answered (exit code 1: FATAL ERROR: v8::ToLocalChecked Empty MaybeLocal)',
    );
    await expect(job).rejects.not.toBeInstanceOf(HeavyLimitError);
  });

  // Nothing but the system kills a child out of hand, and the system does
  // it for want of memory. The same file would meet the same end on every
  // retry: it is a document that needs more memory, not a fault to retry.
  it('fails its job with the limit when something else kills it [KNOW-R22]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = runNodeChild(
      program(
        'killed-from-outside',
        `process.once('message', () => process.kill(process.pid, 'SIGKILL'));
         process.send({ ready: true });`,
      ),
      {},
      { label: 'reading a .xlsx file', memoryMb: 96, readMemory: () => 0 },
    );
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    await expect(job).rejects.toMatchObject({ limitMb: 96 });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'reading a .xlsx file needed more than the 96 MiB',
      ),
    );
  });

  // Four readings a second cannot follow a child that fills memory: it is
  // read sooner at first, and more often once it holds half its cap.
  it('reads what the child holds soon after it starts, however rarely after', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const started = Date.now();
    const job = runNodeChild(
      program(
        'over-at-once',
        `process.once('message', () => setInterval(() => {}, 1000));
         process.send({ ready: true });`,
      ),
      {},
      {
        label: 'reading a .pdf file',
        memoryMb: 100,
        readMemory: () => 101 * 1024 * 1024,
        watchIntervalMs: 60_000,
      },
    );
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it.each([
    ['a tenth of its cap', 10, 'rarely'],
    ['two thirds of its cap', 66, 'often'],
  ] as const)('reads a child that holds %s %s', async (_what, heldMb, how) => {
    let readings = 0;
    const answer = await runNodeChild(
      program(
        `answers-later-${heldMb}`,
        `process.once('message', () => {
             setTimeout(() => process.send({ done: true }, () => process.exit(0)), 700);
           });
           process.send({ ready: true });`,
      ),
      {},
      {
        label: 'reading a .pdf file',
        memoryMb: 100,
        readMemory: () => {
          readings += 1;
          return heldMb * 1024 * 1024;
        },
        watchIntervalMs: 300,
      },
    );
    expect(answer).toEqual({ done: true });
    // Every 300 ms, or every 25: two or three readings, or dozens.
    if (how === 'rarely') expect(readings).toBeLessThan(8);
    else expect(readings).toBeGreaterThan(12);
  });

  it('uses the configured cap where its caller names none', async () => {
    configureHeavySlot({ memoryMb: 80 });
    const job = runNodeChild(
      program(
        'over-the-configured-cap',
        `process.once('message', () => setInterval(() => {}, 1000));
         process.send({ ready: true });`,
      ),
      {},
      // A watch that always reads 81 MiB.
      {
        label: 'configured',
        readMemory: () => 81 * 1024 * 1024,
        watchIntervalMs: 20,
      },
    );
    await expect(job).rejects.toMatchObject({ limitMb: 80 });
  });
});

describe('a command the slot runs', () => {
  it('answers what the command wrote', async () => {
    const { stdout, stderr } = await runCommand(
      process.execPath,
      ['-e', 'process.stdout.write("out"); process.stderr.write("err")'],
      { label: 'a command' },
    );
    expect(stdout).toBe('out');
    expect(stderr).toBe('err');
  });

  it('fails with the end of what the command wrote to stderr', async () => {
    await expect(
      runCommand(
        process.execPath,
        ['-e', 'process.stderr.write("no such stream"); process.exit(4)'],
        { label: 'a command' },
      ),
    ).rejects.toThrow(/exited 4; stderr tail: no such stream$/);
  });

  it('fails when the command cannot be started', async () => {
    await expect(
      runCommand('/nonexistent/ffmpeg', [], {
        label: 'converting a recording',
      }),
    ).rejects.toThrow('converting a recording could not start');
  });

  it('is killed above the cap, and fails with the limit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = runCommand(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        label: 'converting a recording',
        memoryMb: 100,
        readMemory: () => 101 * 1024 * 1024,
        watchIntervalMs: 20,
      },
    );
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    await expect(job).rejects.toMatchObject({ limitMb: 100 });
    // Said once, with what it held when it was stopped.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[heavy-slot] converting a recording needed more than the 100 MiB one file is given and was stopped, holding 101 MiB when last seen; HEAVY_SLOT_MEMORY_MB raises the limit',
    );
  });

  it("is given none of this process's secrets", async () => {
    const before = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://tale:secret@db/tale';
    try {
      const { stdout } = await runCommand(
        process.execPath,
        [
          '-e',
          'process.stdout.write(JSON.stringify(Object.keys(process.env)))',
        ],
        { label: 'a command' },
      );
      const names: unknown = JSON.parse(stdout);
      expect(names).toContain('PATH');
      expect(names).not.toContain('DATABASE_URL');
    } finally {
      if (before === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = before;
    }
  });

  it('fails with the limit when something else kills it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const job = runCommand(
      process.execPath,
      ['-e', 'process.kill(process.pid, "SIGKILL")'],
      { label: 'converting a recording', memoryMb: 96, readMemory: () => 0 },
    );
    await expect(job).rejects.toBeInstanceOf(HeavyLimitError);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('is left alone at its cap', async () => {
    await expect(
      runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 150)'], {
        label: 'a command',
        memoryMb: 100,
        readMemory: () => 100 * 1024 * 1024,
        watchIntervalMs: 20,
      }),
    ).resolves.toEqual({ stdout: '', stderr: '' });
  });

  it('is stopped when its caller gives up', async () => {
    const caller = new AbortController();
    const job = runCommand(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { label: 'a command', signal: caller.signal },
    );
    setTimeout(() => caller.abort(new Error('cancelled')), 100);
    await expect(job).rejects.toThrow('cancelled');
  });
});
