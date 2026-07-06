import { describe, expect, it } from 'vitest';

import {
  isRagIndexableFile,
  resolveFileType,
} from '../../lib/shared/file-types';

describe('OneDrive sync RAG eligibility', () => {
  it('does not index Microsoft Loop files', () => {
    const type = resolveFileType(
      'Daily SCRUM.loop',
      'application/octet-stream',
    );
    expect(isRagIndexableFile('Daily SCRUM.loop', type)).toBe(false);
  });

  it('indexes PDFs even when OneDrive reports octet-stream', () => {
    const type = resolveFileType(
      'status-update.pdf',
      'application/octet-stream',
    );
    expect(isRagIndexableFile('status-update.pdf', type)).toBe(true);
  });

  it('indexes PDFs from resolved application/pdf mime', () => {
    const type = resolveFileType('report', 'application/pdf');
    expect(isRagIndexableFile('report', type)).toBe(true);
  });
});
