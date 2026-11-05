import { describe, expect, it } from 'vitest';

import { buildDocumentAppendix, buildImageAppendix } from './document-appendix';

describe('buildDocumentAppendix', () => {
  it('returns an empty string for no entries', () => {
    expect(buildDocumentAppendix([])).toBe('');
  });

  it('points the model at rag_fetch with the ref for a readable document', () => {
    const appendix = buildDocumentAppendix([
      {
        fileName: 'report.pdf',
        fileId: 'blob_1',
        ragStatus: 'completed',
        reading: 'fetch',
      },
    ]);
    expect(appendix).toContain('report.pdf');
    expect(appendix).toContain('read it with rag_fetch (ref: blob_1)');
    expect(appendix).toContain('Attached documents');
    // The ref is in hand — the appendix never suggests searching the whole
    // organization for a file the model can fetch directly.
    expect(appendix).not.toContain('rag_search');
  });

  // A document is read right after its upload, and the assistant reads that
  // text while its index is still being built, so a queued one reads exactly
  // like an indexed one.
  it('sends the model to rag_fetch for a document whose index is still being built [CHAT-R48]', () => {
    const appendix = buildDocumentAppendix([
      {
        fileName: 'notes.pdf',
        fileId: 'blob_2',
        ragStatus: 'queued',
        reading: 'fetch',
      },
    ]);
    expect(appendix).toContain('read it with rag_fetch (ref: blob_2)');
    expect(appendix).not.toContain('still');
  });

  it('flags a document only its index can serve instead of promising content', () => {
    const appendix = buildDocumentAppendix([
      {
        fileName: 'archive.pdf',
        fileId: 'blob_3',
        ragStatus: 'running',
        reading: 'indexing',
      },
    ]);
    expect(appendix).toContain('can be read only once its index is built');
    expect(appendix).toContain('blob_3');
    expect(appendix).toContain('say so instead of guessing');
  });

  it('is honest about unreadable files, and keeps the ref for a tool that takes files', () => {
    for (const ragStatus of ['failed', 'unsupported', undefined] as const) {
      const appendix = buildDocumentAppendix([
        {
          fileName: 'old.doc',
          fileId: 'blob_4',
          ragStatus,
          reading: 'unreadable',
        },
      ]);
      expect(appendix).toContain('not machine-readable');
      expect(appendix).toContain(`indexing ${ragStatus ?? 'unavailable'}`);
      expect(appendix).not.toContain('rag_fetch (ref');
      expect(appendix).toContain('(ref: blob_4)');
    }
  });

  // A tool that takes files would hand over the bytes the organization's
  // own checks refused, so the refused entry carries no ref at all.
  it('says a refused document cannot be read, and gives no ref', () => {
    const appendix = buildDocumentAppendix([
      {
        fileName: 'keys.txt',
        fileId: 'blob_5',
        ragStatus: 'failed',
        reading: 'refused',
      },
    ]);
    expect(appendix).toContain('secret scan or PII policy refuses its content');
    expect(appendix).not.toContain('blob_5');
  });

  it('names each document’s stored type and size [CHAT-R49]', () => {
    const appendix = buildDocumentAppendix([
      {
        fileName: 'report.pdf',
        fileId: 'blob_1',
        contentType: 'application/pdf',
        sizeBytes: 910_746,
        ragStatus: 'completed',
        reading: 'fetch',
      },
    ]);
    expect(appendix).toContain(
      '"report.pdf" (application/pdf, 889.4 KB, 910,746 bytes)',
    );
  });

  it('lists every document once, in order', () => {
    const appendix = buildDocumentAppendix([
      {
        fileName: 'a.pdf',
        fileId: 'blob_a',
        ragStatus: 'completed',
        reading: 'fetch',
      },
      {
        fileName: 'b.csv',
        fileId: 'blob_b',
        ragStatus: 'completed',
        reading: 'fetch',
      },
    ]);
    expect(appendix.indexOf('a.pdf')).toBeLessThan(appendix.indexOf('b.csv'));
    expect(appendix.match(/a\.pdf/g)).toHaveLength(1);
  });
});

describe('buildImageAppendix', () => {
  it('returns an empty string for no entries', () => {
    expect(buildImageAppendix([])).toBe('');
  });

  it('names every attached image with the ref a tool takes it by', () => {
    // The pixels ride the wire without their file: a model asked to edit an
    // upload once passed "image1.jpg" for want of the ref (2026-10-27).
    const appendix = buildImageAppendix([
      { fileName: 'photo.png', fileId: 's3:acme/photo' },
      { fileName: 'logo.jpg', fileId: 's3:acme/logo' },
    ]);
    expect(appendix).toContain('Attached images');
    expect(appendix).toContain('"photo.png" (ref: s3:acme/photo)');
    expect(appendix).toContain('"logo.jpg" (ref: s3:acme/logo)');
    // It rides turns offered no tool that takes files too, so it names none.
    expect(appendix).not.toMatch(/generate_image|run_code|inputImages/);
    expect(appendix.indexOf('photo.png')).toBeLessThan(
      appendix.indexOf('logo.jpg'),
    );
  });

  // Pixels say nothing about the file they came from: asked for an attached
  // picture's format and size, a model used to fetch it as a document and
  // report the failed read.
  it('names each picture’s stored type and size beside its ref [CHAT-R49]', () => {
    const appendix = buildImageAppendix([
      {
        fileName: 'chart.png',
        fileId: 's3:acme/chart',
        contentType: 'image/png',
        sizeBytes: 910_746,
      },
    ]);
    expect(appendix).toContain(
      '"chart.png" (image/png, 889.4 KB, 910,746 bytes; ref: s3:acme/chart)',
    );
  });

  it('keeps a quote or a line break in a name inside its entry', () => {
    const appendix = buildImageAppendix([
      { fileName: 'a "b"\n- c.png', fileId: 's3:acme/x' },
    ]);
    expect(appendix).toContain(
      String.raw`- "a \"b\"\n- c.png" (ref: s3:acme/x)`,
    );
  });
});
