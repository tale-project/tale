// @vitest-environment node

/**
 * The two conversions of a recording, with the real ffmpeg: from a file to
 * a file, as the heavy slot's process. They run wherever ffmpeg is installed
 * — the platform image, and the integration job, which installs it — and
 * are skipped where it is not.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
  configureHeavySlot,
  DEFAULT_HEAVY_SLOTS,
  heavySlotLoad,
  withHeavySlot,
} from '../../lib/heavy-slot/slot';
import { chunkCompressedAudio, compressAudio } from './audio_preprocess';

// The slot as it is, with the calls that ask for a turn in it counted.
vi.mock('../../lib/heavy-slot/slot', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../lib/heavy-slot/slot')>();
  return { ...original, withHeavySlot: vi.fn(original.withHeavySlot) };
});

const HAS_FFMPEG =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

/** A WAV file: 16 kHz mono 16-bit, a tone with `silenceSec` of silence in
 * its middle. */
function wav(toneSec: number, silenceSec: number): Buffer {
  const rate = 16_000;
  const samples = Math.round((2 * toneSec + silenceSec) * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    const second = i / rate;
    const silent = second >= toneSec && second < toneSec + silenceSec;
    const value = silent ? 0 : Math.round(12_000 * Math.sin(i * 0.2));
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'latin1');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe.runIf(HAS_FFMPEG)('a recording converted from a file', () => {
  let dir: string;
  let recording: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'audio-preprocess-'));
    recording = path.join(dir, 'recording.wav');
    // Three seconds of tone, six of silence, three of tone.
    writeFileSync(recording, wav(3, 6));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  afterEach(() => {
    configureHeavySlot({ slots: DEFAULT_HEAVY_SLOTS });
  });

  function workDir(): string {
    return mkdtempSync(path.join(dir, 'work-'));
  }

  it('is compressed into a file beside it, with the long silence taken out', async () => {
    const work = workDir();
    const compressed = await compressAudio(recording, work);

    expect(compressed.path).toBe(path.join(work, 'compressed.ogg'));
    expect(compressed.sizeBytes).toBe(statSync(compressed.path).size);
    expect(compressed.sizeBytes).toBeGreaterThan(1000);
    // Twelve seconds went in; the six silent ones are down to two.
    expect(compressed.durationSec).toBeGreaterThan(5);
    expect(compressed.durationSec).toBeLessThan(10);

    // The blob reads the file: nothing of the recording is held here.
    expect(compressed.blob.type).toBe('audio/ogg');
    expect(compressed.blob.size).toBe(compressed.sizeBytes);
    const bytes = Buffer.from(await compressed.blob.arrayBuffer());
    expect(bytes.equals(readFileSync(compressed.path))).toBe(true);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('OggS');
  });

  it('is split into pieces that are files too, in order', async () => {
    const work = workDir();
    const compressed = await compressAudio(recording, work);
    const chunks = await chunkCompressedAudio(compressed.path, work);

    // Ninety minutes a piece: a recording of seconds is one piece.
    expect(chunks.map((chunk) => chunk.index)).toEqual([0]);
    expect(chunks[0]?.blob.type).toBe('audio/ogg');
    expect(chunks[0]?.blob.size).toBeGreaterThan(1000);
    expect(chunks[0]?.durationSec).toBeGreaterThan(5);
    const head = Buffer.from(
      await (chunks[0]?.blob.slice(0, 4).arrayBuffer() ?? new ArrayBuffer(0)),
    );
    expect(head.toString('latin1')).toBe('OggS');
  });

  it('waits its turn for the heavy slot', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = withHeavySlot({ priority: 'background' }, () => held);
    const conversion = compressAudio(recording, workDir());
    // ffmpeg would have finished many times over in this half second.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(heavySlotLoad()).toEqual({ running: 1, waiting: 1 });

    release();
    await holder;
    await expect(conversion).resolves.toMatchObject({
      sizeBytes: expect.any(Number),
    });
    expect(heavySlotLoad()).toEqual({ running: 0, waiting: 0 });
  });

  it('fails with what ffmpeg said of a file that is no recording', async () => {
    const work = workDir();
    const notAudio = path.join(work, 'notes.wav');
    writeFileSync(notAudio, 'these are notes, not a recording');
    await expect(compressAudio(notAudio, work)).rejects.toThrow(
      /^ffmpeg exited \d+; stderr tail: [\s\S]*Invalid data found/,
    );
  });

  // A long recording takes minutes to convert: it waits its turn behind a
  // document a chat is waiting to read. The slot holds one job, so the file
  // ffmpeg writes is not there yet when the read runs.
  it('lets a document someone waits for go first', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = workDir();
    let convertedFirst = true;
    const holder = withHeavySlot({ priority: 'background' }, () => held);
    const conversion = compressAudio(recording, work);
    const reading = withHeavySlot({ priority: 'interactive' }, () => {
      convertedFirst = existsSync(path.join(work, 'compressed.ogg'));
      return Promise.resolve();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heavySlotLoad()).toEqual({ running: 1, waiting: 2 });
    release();
    await Promise.all([holder, reading, conversion]);
    expect(convertedFirst).toBe(false);
  });

  it('stops when its caller gives up', async () => {
    const caller = new AbortController();
    caller.abort(new Error('the transcription was cancelled'));
    await expect(
      compressAudio(recording, workDir(), { signal: caller.signal }),
    ).rejects.toThrow('the transcription was cancelled');
  });
});

describe.skipIf(HAS_FFMPEG)(
  'a recording converted where ffmpeg is not installed',
  () => {
    it('fails saying the conversion could not start', async () => {
      const quiet = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const dir = mkdtempSync(path.join(tmpdir(), 'audio-preprocess-'));
      try {
        await expect(
          compressAudio(path.join(dir, 'recording.wav'), dir),
        ).rejects.toThrow('compressing a recording could not start');
      } finally {
        rmSync(dir, { recursive: true, force: true });
        quiet.mockRestore();
      }
    });
  },
);

// Whatever is installed: a conversion asks for its turn before ffmpeg is
// looked for.
describe("a recording's turn in the heavy slot", () => {
  it("is asked for as work a queue brought, with its caller's cancel", async () => {
    vi.mocked(withHeavySlot).mockClear();
    const caller = new AbortController();
    caller.abort(new Error('cancelled before it began'));
    for (const convert of [compressAudio, chunkCompressedAudio]) {
      const dir = mkdtempSync(path.join(tmpdir(), 'audio-preprocess-'));
      try {
        await expect(
          convert(path.join(dir, 'recording.wav'), dir, {
            signal: caller.signal,
          }),
        ).rejects.toThrow('cancelled before it began');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    expect(vi.mocked(withHeavySlot).mock.calls.map(([asked]) => asked)).toEqual(
      [
        { priority: 'background', signal: caller.signal },
        { priority: 'background', signal: caller.signal },
      ],
    );
  });
});
