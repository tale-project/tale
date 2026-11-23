/**
 * What the backend asks of the heavy slot's child, and what the child
 * answers: one request, one answer, then the child is gone.
 *
 * Nothing large crosses the channel. A request names files — the document
 * to read, and where to write what is made of it — and an answer says what
 * was learned and where it was written. The channel carries JSON, so every
 * shape here is plain data.
 */

import type { PiiConfig } from '@tale/shared/schemas/pii';

import type { ExtractedFacts } from '../../core/lib/knowledge/extraction/router.ts';

const MIB = 1024 * 1024;
/** What a child holds before it holds any of a document's text: the
 * runtime, the readers, the chunker. */
const BASE_BYTES = 32 * MIB;

/** How much of the cap is a document's to fill. */
export function textRoom(memoryMb: number): number {
  return Math.max(MIB, memoryMb * MIB - BASE_BYTES);
}

/**
 * The most a reader may write of a document's text, in bytes. The text is
 * read back whole to be scanned and cut: for a moment it is held twice,
 * as the bytes it is decoded from and as the string they make.
 */
export function textLimit(memoryMb: number): number {
  return Math.floor(textRoom(memoryMb) / 2);
}

/** How much the job may take of the file it reads. */
interface ReadLimits {
  /** The cap the child runs under, in MiB: what it may hold, all told. A
   * text that would not fit under it is refused before it is held. */
  readonly memoryMb: number;
  /** The most pixels of one picture a PDF's reader may decode (`pdf.ts`). */
  readonly maxImagePixels: number;
  /** How much of a PDF its reader may have loaded before it opens the
   * document again. */
  readonly reopenAfterBytes: number;
}

/** Read a document's text into `textPath`. */
export interface ExtractRequest extends ReadLimits {
  readonly op: 'extract';
  readonly inputPath: string;
  readonly fileName: string;
  readonly textPath: string;
  readonly processImages: boolean;
}

/**
 * Read a document's text for a reader who is waiting for it, and put it
 * through the secret scan and the organization's PII policy: `textPath`
 * holds the text that may be handed on, when the verdict is `text`.
 */
export interface ReadRequest extends ReadLimits {
  readonly op: 'read';
  readonly inputPath: string;
  readonly fileName: string;
  readonly textPath: string;
  /** A text longer than this is not checked or handed on. */
  readonly maxTextChars: number;
  readonly piiConfig: PiiConfig | null;
}

/**
 * Make a document ready to index: read its text (or take it as given, for a
 * `text` input), scan, apply the policy, cut the chunks, and write them to
 * `chunksPath` with their positions in `indexPath`.
 */
export interface PrepareRequest extends ReadLimits {
  readonly op: 'prepare';
  readonly inputPath: string;
  /** `file`: a document to read. `text`: its text, already read and
   * checked once (a kept read), as UTF-8. */
  readonly input: 'file' | 'text';
  readonly fileName: string;
  readonly title?: string;
  readonly piiConfig: PiiConfig | null;
  /** Where the text is written on its way to the chunks (`file` input). */
  readonly textPath: string;
  readonly chunksPath: string;
  readonly indexPath: string;
}

export type HeavyRequest = ExtractRequest | ReadRequest | PrepareRequest;

export type ReadVerdict =
  /** The text is longer than the reader takes. */
  | { readonly kind: 'too-much' }
  | {
      readonly kind: 'refused';
      readonly skipped: 'secret-detected' | 'pii-blocked' | 'pii-scan-failed';
    }
  | { readonly kind: 'empty' }
  /** `textPath` holds the text, `chars` UTF-16 units of it. */
  | { readonly kind: 'text'; readonly chars: number };

export type PreparedSummary =
  | {
      readonly kind: 'refused';
      readonly skipped: 'secret-detected' | 'pii-blocked' | 'pii-scan-failed';
      readonly reason: string | null;
    }
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly contentHash: string;
      readonly filename: string;
      readonly chunksTotal: number;
    };

/** Why a request failed, as plain data: an extractor's terminal refusal
 * keeps its code, a document that needs more than the cap is said to be
 * one, anything else keeps its message. */
export type HeavyFailure =
  | {
      readonly kind: 'extraction';
      readonly code: 'not_text' | 'malformed';
      readonly message: string;
    }
  /** The document's text would not fit under the cap: the child said so
   * instead of trying, and being stopped. */
  | { readonly kind: 'limit' }
  | { readonly kind: 'other'; readonly message: string };

export type HeavyAnswer =
  | {
      readonly ok: true;
      readonly op: 'extract';
      readonly facts: ExtractedFacts;
      readonly chars: number;
    }
  | {
      readonly ok: true;
      readonly op: 'read';
      readonly facts: ExtractedFacts;
      readonly verdict: ReadVerdict;
    }
  | {
      readonly ok: true;
      readonly op: 'prepare';
      /** What reading the file learned; null for a `text` input. */
      readonly facts: ExtractedFacts | null;
      readonly prepared: PreparedSummary;
    }
  | { readonly ok: false; readonly error: HeavyFailure };
