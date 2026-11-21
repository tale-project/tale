/**
 * What the heavy slot's child does with a request: the work itself, with no
 * process around it.
 *
 * Everything here reads files and writes files. It runs in the child
 * (`heavy-child.ts`), and in the calling process only where a test asked
 * for that (`documents.ts`).
 *
 * This module is the child's whole program, so what it imports is what a
 * child costs to start: the readers, the scan, the policy and the chunker.
 * It must never reach the database layer, the HTTP app or the object store;
 * `scripts/build-backend.test.ts` holds it to that.
 */

import { readFile, writeFile } from 'node:fs/promises';

import {
  SecretScanner,
  type SecretScanResult,
} from '../../../lib/knowledge/secret-scan.ts';
import {
  gateDocumentText,
  prepareContent,
} from '../../core/knowledge/prepare.ts';
import { ExtractionError } from '../../core/lib/knowledge/extraction/errors.ts';
import type { ExtractedFacts } from '../../core/lib/knowledge/extraction/router.ts';
import { piecesOfFile } from '../../core/lib/knowledge/file_extraction/file_pieces.ts';
import { extractDocumentFile } from '../../core/lib/knowledge/file_extraction/router.ts';
import {
  FileTextSink,
  TextLimitError,
} from '../../core/lib/knowledge/file_extraction/text_sink.ts';
import { writeChunkSpool } from './chunk-spool.ts';
import type {
  ExtractRequest,
  HeavyAnswer,
  HeavyRequest,
  PrepareRequest,
  ReadRequest,
} from './protocol.ts';
import { textLimit, textRoom } from './protocol.ts';

const ALLOWED: SecretScanResult = { rejected: false, reason: null };

/** What is known of a text before it is read back. */
interface TextMeasure {
  /** Its size on disk, as UTF-8. */
  readonly bytes: number;
  /** Its length as a string, in UTF-16 units. */
  readonly chars: number;
  /** Whether it holds a character past U+00FF. */
  readonly wide: boolean;
}

/**
 * Whether a text can be held and worked on under the cap.
 *
 * A string is a byte a character, or two for all of them when one is past
 * U+00FF. Read back, the text is held beside its bytes; scanned under a PII
 * policy, beside the copy the scan normalises and the copy it answers,
 * which measured five bytes a character at most. A text that would not fit
 * is refused here, in a sentence, where trying meant holding well over the
 * cap for as long as it took to be stopped.
 */
function textFits(text: TextMeasure, memoryMb: number, pii: boolean): boolean {
  const held = text.chars * (text.wide ? 2 : 1);
  const readBack = text.bytes + held;
  const worked = pii ? text.chars * 5 : held * 1.15;
  return Math.max(readBack, worked) <= textRoom(memoryMb);
}

/** The document needs more than the cap: answered, not died of. */
const OVER_THE_CAP: HeavyAnswer = { ok: false, error: { kind: 'limit' } };

/** A text file's size, length and width, read a piece at a time. */
async function measureText(path: string): Promise<TextMeasure> {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let bytes = 0;
  let chars = 0;
  let wide = false;
  const count = (text: string): void => {
    chars += text.length;
    if (!wide && /[^\u0000-\u00ff]/.test(text)) wide = true;
  };
  for await (const piece of piecesOfFile(path)) {
    bytes += piece.length;
    count(decoder.decode(piece, { stream: true }));
  }
  count(decoder.decode());
  return { bytes, chars, wide };
}

/**
 * Collect what the last phase of a job left behind, where this process may
 * ask for that: the child starts with the collector exposed (`slot.ts`).
 * A job is a few phases, each of which holds much and then needs none of
 * it — a reader's tables, the pieces of a file — and most of that is
 * outside V8's heap, where its own limit does not make it collect. Asked
 * between phases, a job's peak is its largest phase and not their sum.
 */
function collect(): void {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc === 'function') gc();
}

/**
 * The secret scan's verdict on the file at `path`, read a piece at a time.
 * The verdict `scanForSecrets` gives for the same bytes, and, like it, one
 * that allows a file the scan could not read.
 */
async function scanFile(path: string): Promise<SecretScanResult> {
  try {
    const scanner = new SecretScanner();
    // Non-fatal decoding, as the scan of a whole file: a binary file becomes
    // replacement characters, and the detectors find nothing in it.
    const decoder = new TextDecoder('utf-8', { fatal: false });
    for await (const piece of piecesOfFile(path)) {
      scanner.push(decoder.decode(piece, { stream: true }));
    }
    scanner.push(decoder.decode());
    const verdict = scanner.end();
    collect();
    return verdict;
  } catch (error) {
    console.error(
      `[heavy-slot] the secret scan could not read the file, allowing it: ${error instanceof Error ? error.message : String(error)}`,
    );
    return ALLOWED;
  }
}

/**
 * The text in the file at `path`, as one string.
 *
 * Read as bytes and decoded once. Asked for as text, the file comes back as
 * a string joined from half-megabyte pieces, which is laid out flat the
 * first time it is searched: for a moment the pieces and the flat text are
 * both held, on top of each other in the heap whose limit this process runs
 * under. Decoded here, the text is flat from the start, and the bytes it
 * was decoded from are let go of as this returns.
 */
async function readText(path: string): Promise<string> {
  const bytes = await readFile(path);
  return bytes.toString('utf8');
}

/** Read the document into its text file: no more of it than the cap has
 * room for (`TextLimitError`). */
async function extractTo(
  request: ExtractRequest | ReadRequest | PrepareRequest,
  processImages: boolean,
): Promise<{ facts: ExtractedFacts; text: TextMeasure }> {
  const sink = await FileTextSink.create(request.textPath, {
    maxBytes: textLimit(request.memoryMb),
  });
  let facts: ExtractedFacts;
  try {
    facts = await extractDocumentFile(
      request.inputPath,
      request.fileName,
      sink,
      {
        processImages,
        maxImagePixels: request.maxImagePixels,
        reopenAfterBytes: request.reopenAfterBytes,
      },
    );
  } finally {
    await sink.close();
  }
  collect();
  return {
    facts,
    text: { bytes: sink.bytes, chars: sink.chars, wide: sink.wide },
  };
}

async function extract(request: ExtractRequest): Promise<HeavyAnswer> {
  const { facts, text } = await extractTo(request, request.processImages);
  return { ok: true, op: 'extract', facts, chars: text.chars };
}

async function read(request: ReadRequest): Promise<HeavyAnswer> {
  const { facts, text } = await extractTo(request, true);
  if (text.chars > request.maxTextChars) {
    return { ok: true, op: 'read', facts, verdict: { kind: 'too-much' } };
  }
  if (!textFits(text, request.memoryMb, request.piiConfig !== null)) {
    return OVER_THE_CAP;
  }
  const gated = gateDocumentText({
    text: await readText(request.textPath),
    scanned: await scanFile(request.inputPath),
    piiConfig: request.piiConfig,
    filename: request.fileName,
  });
  if (gated.kind !== 'text') {
    return { ok: true, op: 'read', facts, verdict: gated };
  }
  // The text that may be handed on, in place of the text that was read: a
  // policy that masks has masked it.
  await writeFile(request.textPath, gated.text, 'utf8');
  return {
    ok: true,
    op: 'read',
    facts,
    verdict: { kind: 'text', chars: gated.text.length },
  };
}

async function prepare(request: PrepareRequest): Promise<HeavyAnswer> {
  let facts: ExtractedFacts | null = null;
  let scanned: SecretScanResult | undefined;
  let textPath = request.inputPath;
  let text: TextMeasure;
  if (request.input === 'file') {
    // In the order the indexer always worked: the text first, so that a
    // file that does not parse is refused as that, then the scan.
    const extracted = await extractTo(request, true);
    facts = extracted.facts;
    text = extracted.text;
    scanned = await scanFile(request.inputPath);
    textPath = request.textPath;
  } else {
    text = await measureText(textPath);
  }
  if (!textFits(text, request.memoryMb, request.piiConfig !== null)) {
    return OVER_THE_CAP;
  }
  // The text is the one thing of a document this holds whole, and it holds
  // it once: the chunks are cut from it one at a time and written as they
  // are cut. So the text that was read is let go of here, where the
  // organization's policy or the removal of control characters answered
  // another, and the bytes it was decoded from are collected before the
  // cutting starts.
  const source = {
    text: await readText(textPath),
    ...(scanned !== undefined ? { scanned } : {}),
    piiConfig: request.piiConfig,
    filename: request.fileName,
    ...(request.title !== undefined ? { title: request.title } : {}),
  };
  collect();
  const content = prepareContent(source);
  source.text = '';
  if (content.kind !== 'ready') {
    return { ok: true, op: 'prepare', facts, prepared: content };
  }
  collect();
  const chunksTotal = await writeChunkSpool(
    request.chunksPath,
    request.indexPath,
    content.chunks,
  );
  return {
    ok: true,
    op: 'prepare',
    facts,
    prepared: {
      kind: 'ready',
      contentHash: content.contentHash,
      filename: content.filename,
      chunksTotal,
    },
  };
}

/**
 * Do what `request` asks. Never throws: a failure is an answer, so that it
 * crosses a process boundary as plain data and keeps what the caller
 * branches on — an extractor's terminal refusal and its code.
 */
export async function runHeavyRequest(
  request: HeavyRequest,
): Promise<HeavyAnswer> {
  try {
    switch (request.op) {
      case 'extract':
        return await extract(request);
      case 'read':
        return await read(request);
      case 'prepare':
        return await prepare(request);
      default:
        return {
          ok: false,
          error: { kind: 'other', message: 'unknown heavy-slot request' },
        };
    }
  } catch (error) {
    if (error instanceof ExtractionError) {
      return {
        ok: false,
        error: { kind: 'extraction', code: error.code, message: error.message },
      };
    }
    // A reader that wrote all the text the cap has room for, and had more.
    if (error instanceof TextLimitError) return OVER_THE_CAP;
    return {
      ok: false,
      error: {
        kind: 'other',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
