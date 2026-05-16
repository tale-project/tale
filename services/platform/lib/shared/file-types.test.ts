import { describe, expect, it } from 'vitest';

import {
  detectMediaMime,
  extractExtension,
  isAllowedDocumentUpload,
  mimeToExtension,
  resolveFileType,
} from './file-types';

describe('extractExtension', () => {
  it('extracts standard extension', () => {
    expect(extractExtension('file.docx')).toBe('docx');
  });

  it('returns undefined for no extension', () => {
    expect(extractExtension('README')).toBeUndefined();
  });

  it('extracts extension from hidden files', () => {
    expect(extractExtension('.gitignore')).toBe('gitignore');
  });

  it('extracts last extension from double-dot filenames', () => {
    expect(extractExtension('archive.tar.gz')).toBe('gz');
  });

  it('returns undefined for trailing dot', () => {
    expect(extractExtension('file.')).toBeUndefined();
  });

  it('lowercases extensions', () => {
    expect(extractExtension('FILE.DOCX')).toBe('docx');
  });

  it('returns undefined for undefined input', () => {
    expect(extractExtension(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractExtension('')).toBeUndefined();
  });
});

describe('resolveFileType', () => {
  const DOCX_MIME =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const PPTX_MIME =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const PDF_MIME = 'application/pdf';

  it('passes through correct MIME types unchanged', () => {
    expect(resolveFileType('contract.docx', DOCX_MIME)).toBe(DOCX_MIME);
    expect(resolveFileType('report.pdf', PDF_MIME)).toBe(PDF_MIME);
    expect(resolveFileType('photo.jpg', 'image/jpeg')).toBe('image/jpeg');
  });

  it('resolves .docx with empty MIME type', () => {
    expect(resolveFileType('contract.docx', '')).toBe(DOCX_MIME);
  });

  it('resolves .docx reported as application/octet-stream', () => {
    expect(resolveFileType('contract.docx', 'application/octet-stream')).toBe(
      DOCX_MIME,
    );
  });

  it('resolves .docx reported as application/zip', () => {
    expect(resolveFileType('contract.docx', 'application/zip')).toBe(DOCX_MIME);
  });

  it('resolves .pdf with empty MIME type', () => {
    expect(resolveFileType('report.pdf', '')).toBe(PDF_MIME);
  });

  it('resolves .pptx with generic MIME type', () => {
    expect(resolveFileType('slides.pptx', 'application/octet-stream')).toBe(
      PPTX_MIME,
    );
  });

  it('returns original MIME for unknown extension', () => {
    expect(resolveFileType('malware.exe', '')).toBe('');
    expect(resolveFileType('malware.exe', 'application/octet-stream')).toBe(
      'application/octet-stream',
    );
  });

  it('returns original MIME for no extension', () => {
    expect(resolveFileType('README', '')).toBe('');
  });

  it('handles uppercase extensions', () => {
    expect(resolveFileType('CONTRACT.DOCX', '')).toBe(DOCX_MIME);
  });

  it('uses last extension for double-dot filenames', () => {
    expect(resolveFileType('file.tar.gz', '')).toBe('');
  });

  it('resolves common image types', () => {
    expect(resolveFileType('photo.png', '')).toBe('image/png');
    expect(resolveFileType('icon.gif', '')).toBe('image/gif');
    expect(resolveFileType('banner.webp', '')).toBe('image/webp');
  });

  it('resolves spreadsheet types', () => {
    expect(resolveFileType('data.xlsx', '')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(resolveFileType('data.csv', '')).toBe('text/csv');
  });

  it('refuses audio/video browser MIME (media is byte-driven)', () => {
    expect(resolveFileType('song.mp3', 'audio/mpeg')).toBe('');
    expect(resolveFileType('clip.mp4', 'video/mp4')).toBe('');
    expect(resolveFileType('connector.ts', 'video/mp2t')).toBe('');
  });

  it('ignores audio/video extensions (no longer in extension map)', () => {
    expect(resolveFileType('song.mp3', '')).toBe('');
    expect(resolveFileType('clip.mp4', '')).toBe('');
    expect(resolveFileType('broadcast.ts', '')).toBe('');
  });
});

describe('detectMediaMime', () => {
  // Pad a signature out to `size` bytes so the total sample size rule
  // (>= 4 bytes) is satisfied without forcing every fixture to 512 bytes.
  function makeBlob(bytes: number[], size?: number): Blob {
    const total = size ?? Math.max(bytes.length, 16);
    const buf = new Uint8Array(total);
    buf.set(bytes);
    return new Blob([buf]);
  }

  function textBytes(s: string): number[] {
    return Array.from(s).map((c) => c.charCodeAt(0));
  }

  it('detects MPEG TS by 0x47 at offsets 0 and 188', async () => {
    const buf = new Uint8Array(200);
    buf[0] = 0x47;
    buf[188] = 0x47;
    const mime = await detectMediaMime(new Blob([buf]));
    expect(mime).toBe('video/mp2t');
  });

  it('returns null for files too small to contain two MPEG TS packets', async () => {
    const buf = new Uint8Array(100);
    buf[0] = 0x47;
    const mime = await detectMediaMime(new Blob([buf]));
    expect(mime).toBeNull();
  });

  it('detects MP3 with ID3 tag', async () => {
    const mime = await detectMediaMime(makeBlob(textBytes('ID3\x04\x00')));
    expect(mime).toBe('audio/mpeg');
  });

  it('detects raw MP3 frame sync', async () => {
    const mime = await detectMediaMime(makeBlob([0xff, 0xfb, 0x90, 0x00]));
    expect(mime).toBe('audio/mpeg');
  });

  it('detects WAV (RIFF + WAVE)', async () => {
    const bytes = [
      ...textBytes('RIFF'),
      0x24,
      0x00,
      0x00,
      0x00,
      ...textBytes('WAVE'),
    ];
    const mime = await detectMediaMime(makeBlob(bytes));
    expect(mime).toBe('audio/wav');
  });

  it('detects AVI (RIFF + AVI )', async () => {
    const bytes = [
      ...textBytes('RIFF'),
      0x24,
      0x00,
      0x00,
      0x00,
      ...textBytes('AVI '),
    ];
    const mime = await detectMediaMime(makeBlob(bytes));
    expect(mime).toBe('video/x-msvideo');
  });

  it('detects Ogg', async () => {
    const mime = await detectMediaMime(makeBlob(textBytes('OggS\x00\x02')));
    expect(mime).toBe('audio/ogg');
  });

  it('detects WebM/MKV by EBML header', async () => {
    const mime = await detectMediaMime(makeBlob([0x1a, 0x45, 0xdf, 0xa3]));
    expect(mime).toBe('video/webm');
  });

  it('detects MP4 with isom brand as video/mp4', async () => {
    const bytes = [
      0x00,
      0x00,
      0x00,
      0x20,
      ...textBytes('ftyp'),
      ...textBytes('isom'),
    ];
    const mime = await detectMediaMime(makeBlob(bytes));
    expect(mime).toBe('video/mp4');
  });

  it('detects MP4 with M4A brand as audio/mp4', async () => {
    const bytes = [
      0x00,
      0x00,
      0x00,
      0x20,
      ...textBytes('ftyp'),
      ...textBytes('M4A '),
    ];
    const mime = await detectMediaMime(makeBlob(bytes));
    expect(mime).toBe('audio/mp4');
  });

  it('detects MP4 with qt brand as video/quicktime', async () => {
    const bytes = [
      0x00,
      0x00,
      0x00,
      0x20,
      ...textBytes('ftyp'),
      ...textBytes('qt  '),
    ];
    const mime = await detectMediaMime(makeBlob(bytes));
    expect(mime).toBe('video/quicktime');
  });

  it('detects MP4 with 3gp brand as video/3gpp', async () => {
    const bytes = [
      0x00,
      0x00,
      0x00,
      0x20,
      ...textBytes('ftyp'),
      ...textBytes('3gp4'),
    ];
    const mime = await detectMediaMime(makeBlob(bytes));
    expect(mime).toBe('video/3gpp');
  });

  it('returns null for TypeScript source bytes', async () => {
    const src = "import { foo } from './bar';\nexport const x = 1;\n";
    const mime = await detectMediaMime(new Blob([src]));
    expect(mime).toBeNull();
  });

  it('returns null for PDF header', async () => {
    const mime = await detectMediaMime(makeBlob(textBytes('%PDF-1.7')));
    expect(mime).toBeNull();
  });

  it('returns null for PNG header', async () => {
    const mime = await detectMediaMime(
      makeBlob([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(mime).toBeNull();
  });

  it('returns null for empty or too-short blobs', async () => {
    expect(await detectMediaMime(new Blob([]))).toBeNull();
    expect(await detectMediaMime(new Blob([new Uint8Array(2)]))).toBeNull();
  });
});

describe('isAllowedDocumentUpload', () => {
  it.each([
    ['application/pdf', 'report.pdf'],
    ['application/msword', 'file.doc'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'file.docx',
    ],
    [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'slides.pptx',
    ],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'data.xlsx',
    ],
    ['text/csv', 'data.csv'],
    ['text/plain', 'notes.txt'],
    ['image/jpeg', 'photo.jpg'],
    ['image/png', 'screenshot.png'],
    ['image/gif', 'animation.gif'],
    ['image/webp', 'image.webp'],
  ])('allows %s (%s)', (mime, fileName) => {
    expect(isAllowedDocumentUpload(mime, fileName)).toBe(true);
  });

  it.each([
    ['audio/mpeg', 'song.mp3'],
    ['video/mp4', 'video.mp4'],
    ['application/x-msdownload', 'program.exe'],
    ['application/zip', 'archive.zip'],
    ['application/octet-stream', 'unknown.bin'],
    ['', 'file.mp3'],
  ])('rejects %s (%s)', (mime, fileName) => {
    expect(isAllowedDocumentUpload(mime, fileName)).toBe(false);
  });

  it('allows by extension when MIME is generic', () => {
    expect(isAllowedDocumentUpload('application/octet-stream', 'doc.pdf')).toBe(
      true,
    );
    expect(isAllowedDocumentUpload('', 'photo.jpg')).toBe(true);
  });

  it('rejects unknown extensions even with empty MIME', () => {
    expect(isAllowedDocumentUpload('', 'malware.exe')).toBe(false);
    expect(isAllowedDocumentUpload('', 'song.mp3')).toBe(false);
  });
});

describe('mimeToExtension', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['application/pdf', 'pdf'],
    ['application/msword', 'doc'],
    [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'docx',
    ],
    ['application/vnd.ms-powerpoint', 'ppt'],
    [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'pptx',
    ],
    ['application/vnd.ms-excel', 'xls'],
    [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'xlsx',
    ],
    ['text/csv', 'csv'],
    ['text/plain', 'txt'],
  ])('maps %s to %s', (mime, expected) => {
    expect(mimeToExtension(mime)).toBe(expected);
  });

  it('returns undefined for application/octet-stream', () => {
    expect(mimeToExtension('application/octet-stream')).toBeUndefined();
  });

  it('returns undefined for unknown MIME types', () => {
    expect(mimeToExtension('application/x-custom')).toBeUndefined();
    expect(mimeToExtension('application/vnd.unknown')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(mimeToExtension('')).toBeUndefined();
  });

  it('strips MIME parameters', () => {
    expect(mimeToExtension('text/plain; charset=utf-8')).toBe('txt');
    expect(mimeToExtension('application/pdf; version=1.7')).toBe('pdf');
  });

  it('handles uppercase MIME types', () => {
    expect(mimeToExtension('IMAGE/JPEG')).toBe('jpg');
    expect(mimeToExtension('Application/PDF')).toBe('pdf');
  });
});
