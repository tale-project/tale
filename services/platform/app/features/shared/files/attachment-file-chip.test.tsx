import { describe, expect, it } from 'vitest';

import { middleEllipsis } from '@/lib/utils/format/file';
import { render, screen } from '@/tests/utils/render';

import { AttachmentFileChip } from './attachment-file-chip';

describe('AttachmentFileChip', () => {
  it('renders the filename without a MIME string', () => {
    render(
      <AttachmentFileChip
        fileName="report.pdf"
        contentType="application/pdf"
        detail="12.0 KB"
      />,
    );

    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('12.0 KB')).toBeInTheDocument();
    expect(screen.queryByText('application/pdf')).not.toBeInTheDocument();
  });

  it('truncates a long name and keeps the full name on title', () => {
    const longName = 'FIELD SALES AGENT EMPLOYMENT AGREEMENT.docx';
    render(
      <AttachmentFileChip
        fileName={longName}
        contentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      />,
    );

    const truncated = middleEllipsis(longName, 28);
    const label = screen.getByText(truncated);
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute('title', longName);
    expect(
      screen.queryByText(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).not.toBeInTheDocument();
  });

  it('renders a trailing slot', () => {
    render(
      <AttachmentFileChip
        fileName="notes.txt"
        trailing={<button type="button">Download</button>}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Download' }),
    ).toBeInTheDocument();
  });
});
