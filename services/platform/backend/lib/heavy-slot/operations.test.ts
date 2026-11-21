// What the heavy slot's child does with a request, run here without the
// child: the answers it gives for a document the cap has no room for. The
// child says so itself, before it holds the text, where it used to try and
// be stopped at well over the cap (tale-project/tale#4942).

import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { PiiConfig } from '@tale/shared/schemas/pii';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runHeavyRequest } from './operations.ts';
import type { HeavyRequest } from './protocol.ts';

const MIB = 1024 * 1024;
const LIMIT = { ok: false, error: { kind: 'limit' } };

let dir: string;
let serial = 0;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'heavy-operations-'));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A job's files: the input written, the others named. */
function job(input: string | Uint8Array): {
  inputPath: string;
  textPath: string;
  chunksPath: string;
  indexPath: string;
} {
  serial += 1;
  const own = path.join(dir, `job-${serial}`);
  const inputPath = `${own}.input`;
  writeFileSync(inputPath, input);
  return {
    inputPath,
    textPath: `${own}.text`,
    chunksPath: `${own}.chunks`,
    indexPath: `${own}.index`,
  };
}

/** What a request carries beside its files, under a cap of `memoryMb`. */
const under = (memoryMb: number) => ({
  memoryMb,
  maxImagePixels: 6_000_000,
  reopenAfterBytes: 16 * MIB,
});

const MASK: PiiConfig = {
  enabled: true,
  mode: 'mask',
  enabledPatterns: ['email'],
};

/** Lines of plain text, `megabytes` of them. */
const lines = (megabytes: number, line = 'lorem ipsum dolor sit\n'): string =>
  line.repeat(Math.ceil((megabytes * MIB) / line.length));

function prepareText(
  text: string,
  memoryMb: number,
  piiConfig: PiiConfig | null = null,
): Promise<unknown> {
  const request: HeavyRequest = {
    op: 'prepare',
    input: 'text',
    fileName: 'kept.txt',
    piiConfig,
    ...job(text),
    ...under(memoryMb),
  };
  return runHeavyRequest(request);
}

// Under a cap of 64 MiB a document has 32 MiB to fill: the child itself
// takes the rest.
describe('a text the child is given', () => {
  it('is prepared when it fits beside the bytes it is read from', async () => {
    await expect(prepareText(lines(12), 64)).resolves.toMatchObject({
      ok: true,
      op: 'prepare',
      prepared: { kind: 'ready' },
    });
  });

  it('is refused, unread, when it and its bytes are more than the cap has room for', async () => {
    await expect(prepareText(lines(18), 64)).resolves.toEqual(LIMIT);
  });

  // One character past U+00FF, and the whole text is two bytes a character
  // in memory: the twelve megabytes that fit above are twenty-four here.
  it('counts a text twice over when one character of it is wide', async () => {
    await expect(prepareText(`€${lines(12)}`, 64)).resolves.toEqual(LIMIT);
    await expect(prepareText(`é${lines(12)}`, 64)).resolves.toMatchObject({
      ok: true,
      prepared: { kind: 'ready' },
    });
  });

  // The scan of a PII policy holds the text beside the copy it normalises
  // and the copy it answers: five bytes a character.
  it('takes less under a PII policy', async () => {
    await expect(prepareText(lines(8), 64, MASK)).resolves.toEqual(LIMIT);
    await expect(prepareText(lines(4), 64, MASK)).resolves.toMatchObject({
      ok: true,
      prepared: { kind: 'ready' },
    });
  });

  it('has more room under a larger cap', async () => {
    await expect(prepareText(lines(18), 128)).resolves.toMatchObject({
      ok: true,
      prepared: { kind: 'ready' },
    });
  });
});

describe('a file whose text the cap has no room for', () => {
  // Half of what a document may fill is what its text may be on disk: read
  // back, it is held beside its bytes.
  it('is stopped where its text passes that, with the limit, for every request', async () => {
    const file = Buffer.from(lines(20));
    for (const request of [
      {
        op: 'extract' as const,
        fileName: 'long.txt',
        processImages: true,
        ...job(file),
        ...under(64),
      },
      {
        op: 'read' as const,
        fileName: 'long.txt',
        maxTextChars: 64 * MIB,
        piiConfig: null,
        ...job(file),
        ...under(64),
      },
      {
        op: 'prepare' as const,
        input: 'file' as const,
        fileName: 'long.txt',
        piiConfig: null,
        ...job(file),
        ...under(64),
      },
    ]) {
      await expect(runHeavyRequest(request), request.op).resolves.toEqual(
        LIMIT,
      );
      // It stopped writing at sixteen megabytes, of the twenty it had.
      expect(statSync(request.textPath).size).toBeLessThanOrEqual(16 * MIB);
      if ('chunksPath' in request) {
        expect(existsSync(request.chunksPath)).toBe(false);
      }
    }
  });

  it('is read when its text fits', async () => {
    const files = job(Buffer.from(lines(12)));
    await expect(
      runHeavyRequest({
        op: 'prepare',
        input: 'file',
        fileName: 'fits.txt',
        piiConfig: null,
        ...files,
        ...under(64),
      }),
    ).resolves.toMatchObject({ ok: true, prepared: { kind: 'ready' } });
    expect(statSync(files.chunksPath).size).toBeGreaterThan(12 * MIB);
  });

  // A reader waiting for a document takes four megabytes of text at most,
  // and a longer one is left to the document's index: that answer comes
  // before the question of room.
  it('says a text longer than its reader takes is too much, as before', async () => {
    await expect(
      runHeavyRequest({
        op: 'read',
        fileName: 'long.txt',
        maxTextChars: 4 * MIB,
        piiConfig: null,
        ...job(Buffer.from(lines(6))),
        ...under(64),
      }),
    ).resolves.toMatchObject({ ok: true, verdict: { kind: 'too-much' } });
  });
});
