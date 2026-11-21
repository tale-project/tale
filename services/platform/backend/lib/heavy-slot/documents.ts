/**
 * A document's text, through the heavy slot.
 *
 * What the backend calls where it used to fetch a file's bytes and read
 * them in its own memory. Each call here puts the document in a file — a
 * stored object arrives as a stream, and is never held whole — waits for a
 * slot, and has the slot's child read the file under its memory cap
 * (`slot.ts`). What comes back is small: the text for a reader who wants
 * text, and for the indexer a document whose chunks stay on disk until
 * they are stored (`chunk-spool.ts`).
 *
 * A file that needs more than the cap fails with `HeavyLimitError`, which
 * names the limit and the setting that raises it.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PiiConfig } from '@tale/shared/schemas/pii';

import type { PreparedDocument } from '../../core/knowledge/prepare.ts';
import { ExtractionError } from '../../core/lib/knowledge/extraction/errors.ts';
import type {
  ExtractedDocument,
  ExtractedFacts,
} from '../../core/lib/knowledge/extraction/router.ts';
import {
  ObjectTooLargeError,
  s3GetObjectToFile,
  type S3ObjectStore,
} from '../../core/lib/storage/object_store.ts';
import { BUILT } from '../layout.ts';
import { chunksFromSpool } from './chunk-spool.ts';
import { newJobDir, removeJobDir } from './job-dir.ts';
import type { HeavyAnswer, HeavyRequest } from './protocol.ts';
import {
  heavySlotInline,
  heavySlotSettings,
  refusedAtCap,
  runNodeChild,
  withHeavySlot,
  type HeavyPriority,
} from './slot.ts';

const CHILD_URL = new URL(
  BUILT ? './heavy-child.js' : './heavy-child.ts',
  import.meta.url,
);

const MIB = 1024 * 1024;

/** Where a document's bytes are. */
export type DocumentSource =
  | {
      readonly kind: 'store';
      readonly store: S3ObjectStore;
      readonly key: string;
    }
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array };

export interface HeavySlotCall {
  /** Ends the wait for a slot and the work in it; its reason is rethrown. */
  readonly signal?: AbortSignal;
  readonly priority: HeavyPriority;
}

/** The stored object a document was to be read from is not there. */
export class DocumentMissingError extends Error {
  constructor(key: string) {
    super(`S3 GET ${key} failed: 404 the object does not exist`);
    this.name = 'DocumentMissingError';
  }
}

/**
 * How much a job may take, from the cap: the cap itself, which a text must
 * fit under; a sixteenth of it in the pixels of one picture, which pdf.js
 * holds at three or four bytes each; and a sixth of it in the bytes of a PDF
 * before the document is opened again.
 */
function readLimits(): {
  memoryMb: number;
  maxImagePixels: number;
  reopenAfterBytes: number;
} {
  const { memoryMb } = heavySlotSettings();
  const capBytes = memoryMb * MIB;
  return {
    memoryMb,
    maxImagePixels: Math.floor(capBytes / 16),
    reopenAfterBytes: Math.max(8 * MIB, Math.floor(capBytes / 6)),
  };
}

/**
 * What a job is called in the log and in its errors: by the kind of file it
 * reads, never by the file's name. A name is what its owner called it, and
 * can hold a person's name; the file's row says which file it was.
 */
export function jobLabel(fileName: string): string {
  const extension = /\.([A-Za-z0-9]{1,8})$/.exec(fileName)?.[1];
  return extension === undefined
    ? 'reading a file'
    : `reading a .${extension.toLowerCase()} file`;
}

function isAnswer(value: unknown): value is HeavyAnswer {
  if (value === null || typeof value !== 'object' || !('ok' in value)) {
    return false;
  }
  if (value.ok === false) {
    return (
      'error' in value &&
      value.error !== null &&
      typeof value.error === 'object'
    );
  }
  return value.ok === true && 'op' in value && typeof value.op === 'string';
}

/** Have the slot do `request`, and answer what it made; a request that
 * failed throws what it failed with. */
async function ask<Op extends HeavyRequest['op']>(
  request: HeavyRequest & { op: Op },
  call: HeavySlotCall,
): Promise<Extract<HeavyAnswer, { ok: true; op: Op }>> {
  const label = jobLabel(request.fileName);
  const answer: unknown = await withHeavySlot(call, async () => {
    if (heavySlotInline()) {
      const { runHeavyRequest } = await import('./operations.ts');
      return await runHeavyRequest(request);
    }
    return await runNodeChild(CHILD_URL, request, {
      label,
      ...(call.signal !== undefined ? { signal: call.signal } : {}),
    });
  });
  if (!isAnswer(answer)) {
    throw new Error(`${label} ended with an answer that is none`);
  }
  if (!answer.ok) {
    if (answer.error.kind === 'limit') {
      throw refusedAtCap(label, request.memoryMb);
    }
    throw answer.error.kind === 'extraction'
      ? new ExtractionError(answer.error.code, answer.error.message)
      : new Error(answer.error.message);
  }
  if (answer.op !== request.op) {
    throw new Error(`${label} was answered as another request`);
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the answer's `op` is the request's, checked on the line above
  return answer as Extract<HeavyAnswer, { ok: true; op: Op }>;
}

/**
 * Put the document in the job's directory: a stored object as it arrives.
 * `null` when the object is not there.
 */
async function spool(
  source: DocumentSource,
  dir: string,
  options: { signal?: AbortSignal; maxBytes?: number },
): Promise<{ path: string; size: number } | null> {
  const target = path.join(dir, 'input');
  if (source.kind === 'bytes') {
    await writeFile(target, source.bytes, { mode: 0o600 });
    return { path: target, size: source.bytes.byteLength };
  }
  const got = await s3GetObjectToFile(source.store, source.key, target, {
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
  });
  return got === null ? null : { path: target, size: got.size };
}

/**
 * Read a document's text. What `extractDocument` answers for the same
 * bytes, read in the slot's child.
 *
 * Throws what the extractors throw for a file they cannot read, and
 * {@link DocumentMissingError} for a stored object that is not there.
 */
export async function extractInHeavySlot(
  source: DocumentSource,
  fileName: string,
  call: HeavySlotCall & { processImages?: boolean },
): Promise<ExtractedDocument> {
  const dir = await newJobDir();
  try {
    const input = await spool(source, dir, call);
    if (input === null) {
      throw new DocumentMissingError(source.kind === 'store' ? source.key : '');
    }
    const textPath = path.join(dir, 'text');
    const { facts } = await ask(
      {
        op: 'extract',
        inputPath: input.path,
        fileName,
        textPath,
        processImages: call.processImages ?? true,
        ...readLimits(),
      },
      call,
    );
    return { text: await readFile(textPath, 'utf8'), ...facts };
  } finally {
    await removeJobDir(dir);
  }
}

/** What reading a document for a waiting reader came to. */
export type DocumentRead =
  /** The stored object is not there, or holds no bytes. */
  | { readonly kind: 'missing' }
  /** The object holds more bytes than the reader takes of its type. */
  | { readonly kind: 'too-large' }
  /** The text is longer than the reader takes. */
  | { readonly kind: 'too-much'; readonly facts: ExtractedFacts }
  | {
      readonly kind: 'refused';
      readonly skipped: 'secret-detected' | 'pii-blocked' | 'pii-scan-failed';
      readonly facts: ExtractedFacts;
    }
  | { readonly kind: 'empty'; readonly facts: ExtractedFacts }
  /** The text that may be handed on. */
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly facts: ExtractedFacts;
    };

/**
 * Read a stored document's text for a reader who is waiting for it, and put
 * it through the secret scan and the organization's PII policy: the text
 * that comes back may be handed on.
 *
 * Throws what the extractors throw for a file they cannot read.
 */
export async function readInHeavySlot(
  source: Extract<DocumentSource, { kind: 'store' }>,
  fileName: string,
  call: HeavySlotCall & {
    /** The most bytes taken of the object. */
    readonly maxBytes: number;
    /** The most text checked and handed on, in UTF-16 units. */
    readonly maxTextChars: number;
    readonly piiConfig: PiiConfig | null;
  },
): Promise<DocumentRead> {
  const dir = await newJobDir();
  try {
    let input: { path: string; size: number } | null;
    try {
      input = await spool(source, dir, call);
    } catch (error) {
      if (error instanceof ObjectTooLargeError) return { kind: 'too-large' };
      throw error;
    }
    if (input === null || input.size === 0) return { kind: 'missing' };
    const textPath = path.join(dir, 'text');
    const { facts, verdict } = await ask(
      {
        op: 'read',
        inputPath: input.path,
        fileName,
        textPath,
        maxTextChars: call.maxTextChars,
        piiConfig: call.piiConfig,
        ...readLimits(),
      },
      call,
    );
    if (verdict.kind === 'text') {
      return { kind: 'text', text: await readFile(textPath, 'utf8'), facts };
    }
    return { ...verdict, facts };
  } finally {
    await removeJobDir(dir);
  }
}

/** A document made ready to index, with its chunks on disk. */
export interface PreparedFile {
  /** What reading the file learned of it; null for a text that was given. */
  readonly facts: ExtractedFacts | null;
  readonly prepared: PreparedDocument;
  /** Let go of the chunks on disk, once they are stored or not wanted. */
  release(): Promise<void>;
}

/**
 * Make a document ready to index, in the slot's child: its text read (or
 * taken as given, for a `text` that a read already made and checked), the
 * secret scan, the PII policy, the chunker and the hash. The document that
 * comes back hands its chunks over from disk, a slice at a time.
 *
 * `release` must be called when the chunks are stored or no longer wanted.
 * Throws what the extractors throw for a file they cannot read, and
 * {@link DocumentMissingError} for a stored object that is not there.
 */
export async function prepareInHeavySlot(
  source: DocumentSource | { readonly kind: 'text'; readonly text: string },
  fileName: string,
  call: HeavySlotCall & {
    readonly title?: string;
    readonly piiConfig: PiiConfig | null;
  },
): Promise<PreparedFile> {
  const dir = await newJobDir();
  let kept = false;
  try {
    let inputPath: string;
    if (source.kind === 'text') {
      inputPath = path.join(dir, 'input');
      await writeFile(inputPath, source.text, {
        encoding: 'utf8',
        mode: 0o600,
      });
    } else {
      const input = await spool(source, dir, call);
      if (input === null) {
        throw new DocumentMissingError(
          source.kind === 'store' ? source.key : '',
        );
      }
      inputPath = input.path;
    }
    const chunksPath = path.join(dir, 'chunks.jsonl');
    const indexPath = path.join(dir, 'chunks.idx');
    const { facts, prepared } = await ask(
      {
        op: 'prepare',
        inputPath,
        input: source.kind === 'text' ? 'text' : 'file',
        fileName,
        ...(call.title !== undefined ? { title: call.title } : {}),
        piiConfig: call.piiConfig,
        textPath: path.join(dir, 'text'),
        chunksPath,
        indexPath,
        ...readLimits(),
      },
      call,
    );
    if (prepared.kind !== 'ready') {
      return { facts, prepared, release: () => Promise.resolve() };
    }
    const chunks = chunksFromSpool(chunksPath, indexPath, prepared.chunksTotal);
    kept = true;
    return {
      facts,
      prepared: {
        kind: 'ready',
        contentHash: prepared.contentHash,
        filename: prepared.filename,
        chunks,
      },
      release: async () => {
        // The directory goes whatever became of the files in it: a job
        // that could not close them must not leave a document's text on
        // the disk for it.
        try {
          await chunks.close();
        } catch (error) {
          console.warn(
            `[heavy-slot] the chunk files of a job could not be closed: ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          await removeJobDir(dir);
        }
      },
    };
  } finally {
    if (!kept) await removeJobDir(dir);
  }
}
