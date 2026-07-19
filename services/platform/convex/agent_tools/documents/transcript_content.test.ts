import { describe, expect, it } from 'vitest';

import { buildTranscriptContentResult } from './helpers/transcript_content';

/** Mirrors FALLBACK_CHUNK_CHARS in helpers/transcript_content.ts — the test
 * pins the window width because chunk numbers are part of the tool's
 * pagination contract with the model. */
const CHUNK = 2048;

const BASE = { fileId: 'file-1', fileName: 'Video.txt' };

describe('buildTranscriptContentResult', () => {
  it('returns a short transcript as a single chunk', () => {
    const result = buildTranscriptContentResult({
      ...BASE,
      transcript: 'hello world',
    });

    expect(result).toEqual({
      fileId: 'file-1',
      name: 'Video.txt',
      content: 'hello world',
      chunkRange: { start: 1, end: 1 },
      totalChunks: 1,
      truncated: false,
      totalChars: 11,
    });
  });

  it('treats an exactly chunk-sized transcript as one chunk', () => {
    const result = buildTranscriptContentResult({
      ...BASE,
      transcript: 'x'.repeat(CHUNK),
    });

    expect(result.totalChunks).toBe(1);
    expect(result.chunkRange).toEqual({ start: 1, end: 1 });
    expect(result.content).toHaveLength(CHUNK);
  });

  it('splits into contiguous windows and returns all of them by default', () => {
    const transcript = 'a'.repeat(CHUNK) + 'b'.repeat(CHUNK) + 'c'.repeat(500);
    const result = buildTranscriptContentResult({ ...BASE, transcript });

    expect(result.totalChunks).toBe(3);
    expect(result.chunkRange).toEqual({ start: 1, end: 3 });
    expect(result.content).toBe(transcript);
    expect(result.totalChars).toBe(transcript.length);
  });

  it('selects the requested chunk window exactly', () => {
    const transcript = 'a'.repeat(CHUNK) + 'b'.repeat(CHUNK) + 'c'.repeat(500);
    const result = buildTranscriptContentResult({
      ...BASE,
      transcript,
      chunkStart: 2,
      chunkEnd: 2,
    });

    expect(result.content).toBe('b'.repeat(CHUNK));
    expect(result.chunkRange).toEqual({ start: 2, end: 2 });
    expect(result.totalChunks).toBe(3);
    expect(result.totalChars).toBe(CHUNK);
  });

  it('clamps chunkEnd to the last chunk', () => {
    const transcript = 'a'.repeat(CHUNK) + 'b'.repeat(100);
    const result = buildTranscriptContentResult({
      ...BASE,
      transcript,
      chunkStart: 2,
      chunkEnd: 50,
    });

    expect(result.chunkRange).toEqual({ start: 2, end: 2 });
    expect(result.content).toBe('b'.repeat(100));
  });

  it('returns the RAG empty-window shape when chunkStart is out of range', () => {
    const result = buildTranscriptContentResult({
      ...BASE,
      transcript: 'short',
      chunkStart: 5,
    });

    expect(result).toEqual({
      fileId: 'file-1',
      name: 'Video.txt',
      content: '',
      chunkRange: { start: 0, end: 0 },
      totalChunks: 1,
      truncated: false,
      totalChars: 0,
    });
  });

  it('caps returned content at 50K chars and flags truncation', () => {
    const transcript = 'x'.repeat(60_000);
    const result = buildTranscriptContentResult({ ...BASE, transcript });

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(50_000);
    expect(result.totalChars).toBe(60_000);
  });

  it('does not truncate at exactly 50K chars', () => {
    const transcript = 'x'.repeat(50_000);
    const result = buildTranscriptContentResult({ ...BASE, transcript });

    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(50_000);
  });
});
