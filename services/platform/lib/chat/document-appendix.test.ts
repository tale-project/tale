import { describe, expect, it } from 'vitest';

import { buildDocumentAppendix } from './document-appendix';

describe('buildDocumentAppendix', () => {
  it('returns an empty string for no entries', () => {
    expect(buildDocumentAppendix([])).toBe('');
  });

  it('points the model at rag_fetch with the ref for an indexed document', () => {
    const appendix = buildDocumentAppendix([
      { fileName: 'report.pdf', fileId: 'blob_1', ragStatus: 'completed' },
    ]);
    expect(appendix).toContain('report.pdf');
    expect(appendix).toContain('rag_fetch');
    expect(appendix).toContain('blob_1');
    expect(appendix).toContain('Attached documents');
    // The ref is in hand — the appendix never suggests searching the whole
    // organization for a file the model can fetch directly.
    expect(appendix).not.toContain('rag_search');
  });

  it('flags a still-indexing document instead of promising content', () => {
    const appendix = buildDocumentAppendix([
      { fileName: 'notes.txt', fileId: 'blob_2', ragStatus: 'running' },
    ]);
    expect(appendix).toContain('still being indexed');
    expect(appendix).toContain('blob_2');
  });

  it('is honest about unreadable files — failed, unsupported, or never indexed', () => {
    for (const ragStatus of ['failed', 'unsupported', undefined] as const) {
      const appendix = buildDocumentAppendix([
        { fileName: 'old.doc', fileId: 'blob_3', ragStatus },
      ]);
      expect(appendix).toContain('not machine-readable');
      expect(appendix).not.toContain('rag_fetch (ref');
    }
  });

  it('lists every document once, in order', () => {
    const appendix = buildDocumentAppendix([
      { fileName: 'a.pdf', fileId: 'blob_a', ragStatus: 'completed' },
      { fileName: 'b.csv', fileId: 'blob_b', ragStatus: 'completed' },
    ]);
    expect(appendix.indexOf('a.pdf')).toBeLessThan(appendix.indexOf('b.csv'));
    expect(appendix.match(/a\.pdf/g)).toHaveLength(1);
  });
});
