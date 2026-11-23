import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FileTextSink, MemoryTextSink } from './text_sink';

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'text-sink-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('MemoryTextSink', () => {
  it('keeps what it is given, in order, and counts its characters', async () => {
    const sink = new MemoryTextSink();
    await sink.write('one ');
    await sink.write('😀 two');
    expect(sink.text()).toBe('one 😀 two');
    expect(sink.chars).toBe('one 😀 two'.length);
  });

  it('starts again from nothing after a reset', async () => {
    const sink = new MemoryTextSink();
    await sink.write('dropped');
    await sink.reset();
    expect(sink.chars).toBe(0);
    await sink.write('kept');
    expect(sink.text()).toBe('kept');
  });
});

describe('FileTextSink', () => {
  it('writes the text in the order it was given, however it was split', async () => {
    const file = path.join(dir, 'order.txt');
    const sink = await FileTextSink.create(file);
    const pieces: string[] = [];
    for (let i = 0; i < 4000; i += 1) pieces.push(`row ${i} — ünï 😀\n`);
    // Not awaited one by one: a reader hands over a row as it completes it,
    // and several writes are on their way to the file at once.
    await Promise.all(pieces.map((piece) => sink.write(piece)));
    await sink.close();
    expect(readFileSync(file, 'utf8')).toBe(pieces.join(''));
    expect(sink.chars).toBe(pieces.join('').length);
  });

  it('writes what is still gathered when it is closed', async () => {
    const file = path.join(dir, 'short.txt');
    const sink = await FileTextSink.create(file);
    await sink.write('less than it gathers before a write');
    await sink.close();
    expect(readFileSync(file, 'utf8')).toBe(
      'less than it gathers before a write',
    );
  });

  // A character outside the basic plane is two units. A reader may hand
  // them over in two writes, and the file takes text as UTF-8, which cannot
  // carry one unit of the two: written apart they would land as two
  // replacement characters.
  it('keeps a character whole when its two units arrive in two writes', async () => {
    const file = path.join(dir, 'pair.txt');
    const sink = await FileTextSink.create(file);
    const grin = '😀';
    // Enough before it that the first write reaches the file on its own.
    await sink.write(`${'a'.repeat(70_000)}${grin.charAt(0)}`);
    await sink.write(`${grin.charAt(1)} after`);
    await sink.close();
    expect(readFileSync(file, 'utf8')).toBe(
      `${'a'.repeat(70_000)}${grin} after`,
    );
  });

  it('starts again from nothing after a reset', async () => {
    const file = path.join(dir, 'reset.txt');
    const sink = await FileTextSink.create(file);
    await sink.write('x'.repeat(200_000));
    await sink.reset();
    expect(sink.chars).toBe(0);
    await sink.write('kept');
    await sink.close();
    expect(readFileSync(file, 'utf8')).toBe('kept');
  });

  it('never writes over a file that is already there', async () => {
    const file = path.join(dir, 'taken.txt');
    writeFileSync(file, 'somebody else');
    await expect(FileTextSink.create(file)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(readFileSync(file, 'utf8')).toBe('somebody else');
  });

  // A reader writes what the file says to write, and a file can say a great
  // deal in a few bytes. A sink that is given a limit stops the reader
  // there: at the bytes the text is on disk, which for anything but ASCII
  // are more than its characters.
  describe('with a limit', () => {
    let serial = 0;
    const limited = (maxBytes: number): Promise<FileTextSink> => {
      serial += 1;
      return FileTextSink.create(path.join(dir, `limited-${serial}.txt`), {
        maxBytes,
      });
    };

    it('takes text up to the limit, to the byte', async () => {
      const sink = await limited(1000);
      await sink.write('x'.repeat(1000));
      await sink.close();
      expect(sink.bytes).toBe(1000);
      expect(sink.wide).toBe(false);
    });

    it('refuses the write that goes past it, and every write after', async () => {
      const sink = await limited(1000);
      await sink.write('x'.repeat(600));
      await expect(sink.write('y'.repeat(401))).rejects.toMatchObject({
        name: 'TextLimitError',
        maxBytes: 1000,
      });
      await expect(sink.write('z')).rejects.toMatchObject({
        name: 'TextLimitError',
      });
      await sink.close();
      expect(sink.bytes).toBeLessThanOrEqual(1000);
    });

    it('counts bytes, not characters', async () => {
      // Four hundred characters of three bytes each: within a limit of a
      // thousand as characters, past it as the bytes they are written as.
      const sink = await limited(1000);
      const written = sink.write('€'.repeat(400)).then(() => sink.close());
      await expect(written).rejects.toMatchObject({ name: 'TextLimitError' });
    });

    it('stops a reader that does not wait for its writes', async () => {
      const sink = await limited(100_000);
      const row = `${'cell | '.repeat(40)}\n`;
      const writes = Array.from({ length: 2000 }, () => sink.write(row));
      const settled = await Promise.allSettled(writes);
      expect(settled.some((write) => write.status === 'rejected')).toBe(true);
      // What it took before the limit is in the file, and no more.
      await sink.close();
      expect(sink.bytes).toBeLessThanOrEqual(100_000);
      expect(sink.bytes).toBeGreaterThan(90_000);
    });

    it('says whether the text holds a character past U+00FF, and starts again after a reset', async () => {
      const sink = await limited(10_000);
      await sink.write('Zürich, façade');
      await sink.close();
      expect(sink.wide).toBe(false);

      // Enough that the sink hands it to the file, and so has seen it.
      const wide = await limited(1_000_000);
      await wide.write(`${'a'.repeat(70_000)} 20 €`);
      await wide.write('b'.repeat(70_000));
      expect(wide.wide).toBe(true);
      expect(wide.bytes).toBeGreaterThan(70_000);
      await wide.reset();
      expect(wide.bytes).toBe(0);
      expect(wide.wide).toBe(false);
      await wide.write('plain again');
      await wide.close();
      expect(wide.bytes).toBe(11);
      expect(wide.wide).toBe(false);
    });
  });

  // The sink encodes a slice at a time into one buffer. What lands in the
  // file must be the bytes of the whole text encoded at once, wherever a
  // slice, a write or the buffer ends: also for the halves of a character
  // that arrive apart, and for a half that has no other.
  describe('writes the bytes of the whole text', () => {
    const grin = '😀';
    const first = grin.charAt(0);
    const second = grin.charAt(1);
    let serial = 0;

    async function written(parts: readonly string[]): Promise<Buffer> {
      serial += 1;
      const file = path.join(dir, `bytes-${serial}.txt`);
      const sink = await FileTextSink.create(file);
      for (const part of parts) await sink.write(part);
      await sink.close();
      expect(sink.chars).toBe(parts.join('').length);
      return readFileSync(file);
    }
    const whole = (parts: readonly string[]): Buffer =>
      Buffer.from(parts.join(''), 'utf8');

    it.each([
      ['a text longer than the buffer in one write', ['é€😀'.repeat(150_000)]],
      [
        'a character whose halves end one slice and start the next',
        [`${'a'.repeat(16 * 1024 - 1)}${grin}${'b'.repeat(40_000)}`],
      ],
      [
        'a character whose halves are the end and the start of two writes',
        [`${'a'.repeat(10)}${first}`, `${second}${'b'.repeat(10)}`],
      ],
      [
        'a character whose halves are two writes of their own',
        ['a', first, second, 'b'],
      ],
      ['a first half with nothing after it', [`text ${first}`]],
      ['a first half followed by text', [`text ${first}`, ' more']],
      ['a second half with nothing before it', [`${second} text`]],
      ['two first halves and then a whole character', [first, first, grin]],
      ['nothing', []],
      ['writes of nothing', ['', 'a', '', '']],
    ])('for %s', async (_what, parts) => {
      expect(await written(parts)).toEqual(whole(parts));
    });

    it('for random texts in random writes, around every size it gathers and encodes at', async () => {
      let state = 4942;
      const next = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x1_0000_0000;
      };
      const units = ['a', 'é', '€', grin, first, second, '\n', ' '];
      const sizes = [
        0, 1, 2, 7, 16_383, 16_384, 16_385, 65_535, 65_536, 70_001,
      ];
      for (let round = 0; round < 40; round += 1) {
        const parts: string[] = [];
        const count = 1 + Math.floor(next() * 8);
        for (let part = 0; part < count; part += 1) {
          const size = sizes[Math.floor(next() * sizes.length)] ?? 0;
          // Filler, with a few units of every width at each end, where a
          // write meets the one before it and the one after it.
          const edge = (): string =>
            Array.from(
              { length: Math.floor(next() * 4) },
              () => units[Math.floor(next() * units.length)] ?? 'a',
            ).join('');
          parts.push(`${edge()}${'x'.repeat(size)}${edge()}`);
        }
        expect(
          (await written(parts)).equals(whole(parts)),
          `round ${round}: ${parts.map((part) => part.length).join(', ')} units`,
        ).toBe(true);
      }
    });
  });
});
