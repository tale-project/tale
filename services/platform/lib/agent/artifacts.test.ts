import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_NAME_MAX_CHARS,
  artifactMediaType,
  extensionOf,
  safeArtifactName,
  TEXT_ARTIFACT_TYPES,
  uniqueArtifactName,
} from './artifacts';

describe('extensionOf', () => {
  it('reads the last extension, lower-cased', () => {
    expect(extensionOf('Report.Final.DOCX')).toBe('docx');
    expect(extensionOf('notes.md')).toBe('md');
  });

  it('has none for a bare name, a dotfile or a trailing dot', () => {
    expect(extensionOf('Makefile')).toBe('');
    expect(extensionOf('.env')).toBe('');
    expect(extensionOf('draft.')).toBe('');
  });
});

describe('artifactMediaType', () => {
  it('serves a typed-out format with its text type', () => {
    expect(artifactMediaType('table.csv')).toBe('text/csv');
    expect(artifactMediaType('logo.SVG')).toBe('image/svg+xml');
  });

  it('serves the documents a sandbox delivers with their own type', () => {
    expect(artifactMediaType('deck.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(artifactMediaType('chart.png')).toBe('image/png');
    expect(artifactMediaType('report.pdf')).toBe('application/pdf');
  });

  it('falls back to a generic type for anything unknown', () => {
    expect(artifactMediaType('data.parquet')).toBe('application/octet-stream');
  });

  it('never lists a binary format as typeable', () => {
    for (const binary of ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'zip']) {
      expect(TEXT_ARTIFACT_TYPES[binary]).toBeUndefined();
    }
  });
});

describe('safeArtifactName', () => {
  it('keeps a plain name', () => {
    expect(safeArtifactName('Q3 summary.md')).toBe('Q3 summary.md');
  });

  it('drops folders and hidden-file dots', () => {
    expect(safeArtifactName('../../etc/passwd')).toBe('passwd');
    expect(safeArtifactName('C:\\tmp\\x.csv')).toBe('x.csv');
    expect(safeArtifactName('...hidden.txt')).toBe('hidden.txt');
  });

  it('replaces control and reserved characters', () => {
    expect(safeArtifactName('a\u0000b?c*.txt')).toBe('a-b-c-.txt');
  });

  it('refuses a name with nothing usable left', () => {
    expect(safeArtifactName('')).toBeNull();
    expect(safeArtifactName('///')).toBeNull();
    expect(safeArtifactName('...')).toBeNull();
  });

  it('shortens a long name but keeps its extension', () => {
    const name = safeArtifactName(`${'x'.repeat(300)}.xlsx`);
    expect(name).not.toBeNull();
    expect(name?.length).toBeLessThanOrEqual(ARTIFACT_NAME_MAX_CHARS);
    expect(name?.endsWith('.xlsx')).toBe(true);
  });
});

describe('uniqueArtifactName', () => {
  it('keeps a free name', () => {
    expect(uniqueArtifactName('a.pdf', new Set(['b.pdf']))).toBe('a.pdf');
  });

  it('numbers a taken name the way a download folder does', () => {
    expect(uniqueArtifactName('a.pdf', new Set(['a.pdf']))).toBe('a (2).pdf');
    expect(uniqueArtifactName('a.pdf', new Set(['a.pdf', 'a (2).pdf']))).toBe(
      'a (3).pdf',
    );
    expect(uniqueArtifactName('README', new Set(['README']))).toBe(
      'README (2)',
    );
  });
});
