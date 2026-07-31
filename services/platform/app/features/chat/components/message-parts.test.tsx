// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { AttachmentPreviewProvider } from '../hooks/attachment-preview-context';
import type { MessagePart } from '../types';
import { MessageParts } from './message-parts';

// The image thumbnails resolve display URLs through one batched Convex
// query; the harness has no provider, so the seam is scripted per test.
const { useFileUrlsMock } = vi.hoisted(() => ({ useFileUrlsMock: vi.fn() }));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrls: (fileIds: string[]) => useFileUrlsMock(fileIds),
}));

const IMAGE_PART: MessagePart = {
  type: 'attachment',
  name: 'shot.png',
  mediaType: 'image/png',
  fileId: 'blob1',
  sizeBytes: 4096,
};

describe('MessageParts — image attachments', () => {
  it('renders a resolved image as a thumbnail button', () => {
    useFileUrlsMock.mockReturnValue({
      data: [{ fileId: 'blob1', url: 'https://files.test/blob1' }],
    });
    render(
      <MessageParts
        parts={[{ type: 'text', text: 'look at this' }, IMAGE_PART]}
      />,
    );

    expect(screen.getByText('look at this')).toBeInTheDocument();
    const thumb = screen.getByRole('button', { name: 'View image' });
    expect(thumb.querySelector('img')).toHaveAttribute(
      'src',
      'https://files.test/blob1',
    );
  });

  it("groups all of a message's images into one row", () => {
    useFileUrlsMock.mockReturnValue({
      data: [
        { fileId: 'blob1', url: 'https://files.test/blob1' },
        { fileId: 'blob2', url: 'https://files.test/blob2' },
      ],
    });
    render(
      <MessageParts
        parts={[
          { type: 'text', text: 'two shots' },
          IMAGE_PART,
          { ...IMAGE_PART, name: 'shot2.png', fileId: 'blob2' },
        ]}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'View image' })).toHaveLength(
      2,
    );
  });

  it('falls back to the file chip when the URL resolves to null', () => {
    // A deleted blob or an unauthenticated shared view: never a broken <img>.
    useFileUrlsMock.mockReturnValue({
      data: [{ fileId: 'blob1', url: null }],
    });
    render(<MessageParts parts={[IMAGE_PART]} />);

    expect(
      screen.queryByRole('button', { name: 'View image' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Attachment: shot.png')).toBeInTheDocument();
  });

  it('keeps the plain chip for a ref-less attachment part', () => {
    useFileUrlsMock.mockReturnValue({ data: [] });
    render(
      <MessageParts
        parts={[
          {
            type: 'attachment',
            name: 'legacy.pdf',
            mediaType: 'application/pdf',
          },
        ]}
      />,
    );

    expect(screen.getByText('Attachment: legacy.pdf')).toBeInTheDocument();
  });
});

describe('MessageParts — local sent-image previews', () => {
  it('paints from the surface preview map before any server URL resolves', () => {
    // The server query has not answered yet — without the local preview this
    // would be a skeleton; with it the image is up instantly.
    useFileUrlsMock.mockReturnValue({ data: undefined });
    const previews = new Map([['blob1', 'blob:local-preview']]);
    render(
      <AttachmentPreviewProvider value={previews}>
        <MessageParts
          parts={[{ type: 'text', text: 'sent just now' }, IMAGE_PART]}
        />
      </AttachmentPreviewProvider>,
    );

    const thumb = screen.getByRole('button', { name: 'View image' });
    expect(thumb.querySelector('img')).toHaveAttribute(
      'src',
      'blob:local-preview',
    );
  });

  it('prefers the local preview over the server URL — no swap, no flash', () => {
    useFileUrlsMock.mockReturnValue({
      data: [{ fileId: 'blob1', url: 'https://files.test/blob1' }],
    });
    const previews = new Map([['blob1', 'blob:local-preview']]);
    render(
      <AttachmentPreviewProvider value={previews}>
        <MessageParts parts={[IMAGE_PART]} />
      </AttachmentPreviewProvider>,
    );

    const thumb = screen.getByRole('button', { name: 'View image' });
    expect(thumb.querySelector('img')).toHaveAttribute(
      'src',
      'blob:local-preview',
    );
  });
});
