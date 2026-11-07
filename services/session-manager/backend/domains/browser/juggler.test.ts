import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, runInNewContext } from 'node:vm';

import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ANSWER_WAIT_MS,
  EDITS,
  MARKER,
  SCRIPTS_NOTE,
  TURN_WAIT_MS,
  WITHIN,
  applyEdits,
  boundInputWaits,
  clearStaleScripts,
} from './juggler.ts';
import type { Edit } from './juggler.ts';

const PAGE_HANDLER = 'chrome/juggler/content/protocol/PageHandler.js';
const TARGET_REGISTRY = 'chrome/juggler/content/TargetRegistry.js';
const OTHER = 'chrome/juggler/content/Helper.js';

const temporary: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sm-juggler-test-'));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporary.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A file that has what the changes look for, as often as they want it, among other lines. */
function knownFile(edits: readonly Edit[]): string {
  const parts = ['"use strict";\n'];
  for (const edit of edits) {
    for (let i = 0; i < (edit.times ?? 1); i++) {
      parts.push(`${edit.find}\n`, '  // something else\n');
    }
  }
  return parts.join('');
}

function files(
  overrides: Partial<Record<string, string | null>> = {},
): Record<string, string | null> {
  return {
    [PAGE_HANDLER]: knownFile(EDITS[PAGE_HANDLER] ?? []),
    [TARGET_REGISTRY]: knownFile(EDITS[TARGET_REGISTRY] ?? []),
    [OTHER]: 'export class Helper {}\n',
    ...overrides,
  };
}

/** An `omni.ja` with these files, stored uncompressed as Mozilla stores them; null leaves one out. */
function omniJa(contents: Record<string, string | null> = files()): string {
  const zip = new AdmZip();
  for (const [name, text] of Object.entries(contents)) {
    if (text === null) continue;
    zip.addFile(name, Buffer.from(text, 'utf8'));
    const entry = zip.getEntry(name);
    if (entry !== null) entry.header.method = 0;
  }
  const file = join(tempDir(), 'omni.ja');
  writeFileSync(file, zip.toBuffer(), { mode: 0o755 });
  return file;
}

function read(file: string, name: string): string {
  const entry = new AdmZip(file).getEntry(name);
  if (entry === null) throw new Error(`${name} is not in ${file}`);
  return entry.getData().toString('utf8');
}

describe('boundInputWaits', () => {
  it('bounds the waits for the renderer, the compositor, a switch of tabs and a whole turn', async () => {
    const file = omniJa();
    expect(await boundInputWaits(file)).toBe('changed');

    const handler = read(file, PAGE_HANDLER);
    expect(handler).toContain(MARKER);
    expect(handler).toContain(
      `return smWithin(watcher.ensureEvent(eventType, eventObject => eventObject.jugglerEventId === jugglerEventId), ${ANSWER_WAIT_MS},`,
    );
    expect(
      handler.split(
        `await smWithin(helper.awaitTopic('apz-repaints-flushed'), ${ANSWER_WAIT_MS},`,
      ),
    ).toHaveLength(3);
    expect(handler).not.toContain(
      "        await helper.awaitTopic('apz-repaints-flushed');",
    );
    const registry = read(file, TARGET_REGISTRY);
    expect(registry).toContain(MARKER);
    expect(registry).toContain(
      `await smWithin(promise, ${TURN_WAIT_MS}, 'the switch to a tab');`,
    );
    expect(registry).toContain(
      `await smWithin(callback(), ${TURN_WAIT_MS}, 'a turn of input');`,
    );
  });

  it('leaves the rest of the file as it was: the other files, their order, how they are stored, its mode', async () => {
    const file = omniJa();
    const before = new AdmZip(file).getEntries();
    await boundInputWaits(file);

    const after = new AdmZip(file).getEntries();
    expect(after.map((entry) => entry.entryName)).toEqual(
      before.map((entry) => entry.entryName),
    );
    expect(after.map((entry) => entry.header.method)).toEqual([0, 0, 0]);
    expect(read(file, OTHER)).toBe('export class Helper {}\n');
    expect(statSync(file).mode & 0o777).toBe(0o755);
  });

  it('keeps the file as it came next to it, and nothing else', async () => {
    const file = omniJa();
    const original = readFileSync(file);
    await boundInputWaits(file);
    expect(readFileSync(`${file}.orig`)).toEqual(original);
    expect(readdirSync(join(file, '..')).sort()).toEqual([
      'omni.ja',
      'omni.ja.orig',
    ]);
  });

  it('keeps the copy as it came from an earlier change', async () => {
    const file = omniJa();
    writeFileSync(`${file}.orig`, 'the file as it came');
    await boundInputWaits(file);
    expect(readFileSync(`${file}.orig`, 'utf8')).toBe('the file as it came');
  });

  it('leaves a build it changed before alone', async () => {
    const file = omniJa();
    await boundInputWaits(file);
    const changed = readFileSync(file);
    expect(await boundInputWaits(file)).toBe('bounded');
    expect(readFileSync(file)).toEqual(changed);
  });

  it('leaves a build that bounds the waits itself alone', async () => {
    const file = omniJa(
      files({ [PAGE_HANDLER]: 'export const kAckDeadlineMs = 5000;\n' }),
    );
    const original = readFileSync(file);
    expect(await boundInputWaits(file)).toBe('bounded');
    expect(readFileSync(file)).toEqual(original);
    expect(existsSync(`${file}.orig`)).toBe(false);
  });

  it.each([
    ['a file is not there', files({ [TARGET_REGISTRY]: null })],
    [
      'what a change looks for is not in a file',
      files({ [TARGET_REGISTRY]: knownFile([]) }),
    ],
    [
      'it is in a file more often than the change knows',
      files({
        [TARGET_REGISTRY]: `${knownFile(EDITS[TARGET_REGISTRY] ?? [])}        await callback();\n`,
      }),
    ],
    [
      'one file is changed and the other is not',
      files({ [TARGET_REGISTRY]: `${MARKER}\n` }),
    ],
  ])('leaves a build it does not know alone: %s', async (_case, contents) => {
    const file = omniJa(contents);
    const original = readFileSync(file);
    expect(await boundInputWaits(file)).toBe('unknown');
    expect(readFileSync(file)).toEqual(original);
    expect(existsSync(`${file}.orig`)).toBe(false);
  });

  it('says when there is no build', async () => {
    expect(await boundInputWaits(join(tempDir(), 'omni.ja'))).toBe('missing');
  });
});

describe('clearStaleScripts', () => {
  /** A profile whose browser left compiled copies of the scripts. */
  function profile(): { dir: string; cache: string } {
    const dir = tempDir();
    const cache = join(dir, 'startupCache');
    mkdirSync(cache);
    writeFileSync(join(cache, 'scriptCache.bin'), 'compiled');
    writeFileSync(join(dir, 'prefs.js'), 'kept');
    return { dir, cache };
  }

  it('deletes the copies a profile made before (it has no note), and notes the build', async () => {
    const file = omniJa();
    const { dir, cache } = profile();
    await clearStaleScripts({ omniJa: file, profileDir: dir });
    expect(existsSync(cache)).toBe(false);
    expect(readFileSync(join(dir, 'prefs.js'), 'utf8')).toBe('kept');
    expect(existsSync(join(dir, SCRIPTS_NOTE))).toBe(true);
  });

  it('keeps the copies made from the build it starts with', async () => {
    const file = omniJa();
    const { dir, cache } = profile();
    await clearStaleScripts({ omniJa: file, profileDir: dir });
    mkdirSync(cache);
    await clearStaleScripts({ omniJa: file, profileDir: dir });
    expect(existsSync(cache)).toBe(true);
  });

  it('deletes them again once the build is changed', async () => {
    const file = omniJa();
    const { dir, cache } = profile();
    await clearStaleScripts({ omniJa: file, profileDir: dir });
    mkdirSync(cache);
    expect(await boundInputWaits(file)).toBe('changed');
    await clearStaleScripts({ omniJa: file, profileDir: dir });
    expect(existsSync(cache)).toBe(false);
  });

  it('deletes them when the build is another one of the same size', async () => {
    const file = omniJa();
    const { dir, cache } = profile();
    await clearStaleScripts({ omniJa: file, profileDir: dir });
    mkdirSync(cache);
    utimesSync(file, new Date(2026, 0, 1), new Date(2026, 0, 1));
    await clearStaleScripts({ omniJa: file, profileDir: dir });
    expect(existsSync(cache)).toBe(false);
  });

  it('has nothing to delete in a new profile, and notes the build', async () => {
    const file = omniJa();
    const dir = tempDir();
    await clearStaleScripts({ omniJa: file, profileDir: dir });
    expect(readdirSync(dir)).toEqual([SCRIPTS_NOTE]);
  });
});

describe('applyEdits', () => {
  it('changes every place a change looks for', () => {
    expect(applyEdits('a b a', [{ find: 'a', replace: 'c', times: 2 }])).toBe(
      'c b c',
    );
  });

  it('changes nothing unless each change finds what it looks for as often as it must', () => {
    expect(applyEdits('a b', [{ find: 'a', replace: 'c', times: 2 }])).toBe(
      null,
    );
    expect(
      applyEdits('a b', [
        { find: 'a', replace: 'c' },
        { find: 'x', replace: 'y' },
      ]),
    ).toBe(null);
  });
});

type Within = (
  promise: Promise<unknown>,
  ms: number,
  what: string,
) => Promise<unknown>;

function isWithin(value: unknown): value is Within {
  return typeof value === 'function';
}

/** `smWithin` of the build, run here with Firefox's timers and `dump` stood in for. */
function smWithin(dumped: string[]): Within {
  const context: Record<string, unknown> = {
    ChromeUtils: { importESModule: () => ({ setTimeout, clearTimeout }) },
    dump: (text: string) => dumped.push(text),
    Promise,
  };
  runInNewContext(WITHIN, context);
  const within = context.smWithin;
  if (!isWithin(within)) throw new Error('the build is given no smWithin');
  return within;
}

describe('the JavaScript the build is given', () => {
  it('answers with what was waited for when it comes in time', async () => {
    const dumped: string[] = [];
    await expect(
      smWithin(dumped)(Promise.resolve('ack'), 1000, 'an answer'),
    ).resolves.toBe('ack');
    await expect(
      smWithin(dumped)(Promise.reject(new Error('closed')), 1000, 'an answer'),
    ).rejects.toThrow('closed');
    expect(dumped).toEqual([]);
  });

  it('gives up on an answer that does not come, and says so', async () => {
    const dumped: string[] = [];
    const started = Date.now();
    await expect(
      smWithin(dumped)(new Promise(() => {}), 50, 'the answer to a mousemove'),
    ).resolves.toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
    expect(dumped).toEqual([
      '[juggler] gave up waiting for the answer to a mousemove after 50 ms\n',
    ]);
  });

  it('is JavaScript where each change puts it', () => {
    // Each changed line in the body of an async function, as in the build:
    // compiled, not run.
    for (const edits of Object.values(EDITS)) {
      for (const edit of edits) {
        expect(
          () => new Script(`(async () => {\n${edit.replace}\n});`),
        ).not.toThrow();
      }
    }
  });
});
