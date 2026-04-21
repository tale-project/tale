import { describe, expect, it } from 'vitest';

import {
  extractExtension,
  isAllowedDocumentUpload,
  mimeToExtension,
  resolveFileType,
} from '../file-types';

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
