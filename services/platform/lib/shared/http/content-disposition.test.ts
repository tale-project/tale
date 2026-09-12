import { describe, expect, it } from 'vitest';

import { attachmentDisposition } from './content-disposition';

describe('attachmentDisposition', () => {
  it('names an ASCII file in both forms', () => {
    expect(attachmentDisposition('report.pdf')).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it('keeps a non-ASCII name exactly in filename* and degrades the ASCII fallback', () => {
    expect(attachmentDisposition('Zürich – Bericht (final)*.pdf')).toBe(
      `attachment; filename="Z_rich _ Bericht (final)*.pdf"; filename*=UTF-8''Z%C3%BCrich%20%E2%80%93%20Bericht%20%28final%29%2A.pdf`,
    );
  });

  it('strips control characters and quote-unsafe characters, and never emits an empty name', () => {
    expect(attachmentDisposition('a"b\r\nc\\d.pdf')).toBe(
      `attachment; filename="a_bc_d.pdf"; filename*=UTF-8''a%22bc%5Cd.pdf`,
    );
    expect(attachmentDisposition(' \u0000 ')).toBe(
      `attachment; filename="download"; filename*=UTF-8''download`,
    );
  });
});
