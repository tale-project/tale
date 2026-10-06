import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { FileAttachmentsList } from './file-attachments-list';
import { storedAttachedFile, type AttachedFile } from './types';

const picked: AttachedFile = {
  id: 'f1',
  file: new File(['%PDF-1.4'], 'invoice.pdf', { type: 'application/pdf' }),
  type: 'document',
};

// The chip draws a long name cut in the middle; the ✕ must still name the
// whole file, or two similar names read the same.
const LONG_NAME = 'quarterly-report-for-the-board-of-directors-2026-q3.xlsx';

/**
 * The ✕ on each file in the reply box removes that file. It had no accessible
 * name, so a screen reader announced "button" beside every file (WCAG 4.1.2).
 */
describe('FileAttachmentsList', () => {
  it('names each remove button after the file it removes', async () => {
    const onRemove = vi.fn();
    const { user } = render(
      <FileAttachmentsList files={[picked]} onRemove={onRemove} />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Remove invoice.pdf' }),
    );

    expect(onRemove).toHaveBeenCalledWith('f1');
  });

  it('lets no file be removed while the files are being sent', async () => {
    const onRemove = vi.fn();
    const { user } = render(
      <FileAttachmentsList files={[picked]} onRemove={onRemove} disabled />,
    );

    const remove = screen.getByRole('button', { name: 'Remove invoice.pdf' });
    expect(remove).toBeDisabled();
    await user.click(remove);

    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
  });

  it('names the button with the whole name while the chip shows it cut', () => {
    const long: AttachedFile = {
      id: 'f2',
      file: new File(['x'], LONG_NAME),
      type: 'document',
    };
    render(<FileAttachmentsList files={[long]} onRemove={vi.fn()} />);

    expect(screen.queryByText(LONG_NAME)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Remove ${LONG_NAME}` }),
    ).toBeInTheDocument();
  });

  it('names and sizes a file an undone send handed back', () => {
    const handedBack = storedAttachedFile({
      storageId: 's3:org1/invoice',
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
      size: 2048,
    });
    render(<FileAttachmentsList files={[handedBack]} onRemove={vi.fn()} />);

    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove invoice.pdf' }),
    ).toBeInTheDocument();
  });

  it('passes axe audit', async () => {
    const { container } = render(
      <FileAttachmentsList files={[picked]} onRemove={vi.fn()} />,
    );
    await checkAccessibility(container);
  });
});
