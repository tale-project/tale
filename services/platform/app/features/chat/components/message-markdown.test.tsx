/**
 * A reply's text can name a stored file by the reference a tool answered
 * with. The reply's own files already show under it, so the text never
 * draws them again; a link to a stored file opens its preview; another
 * stored file is drawn only when the reader may open it; and an image no
 * one can draw reads as its words, never as a grey placeholder.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import { MessageMarkdown } from './message-markdown';

const { urls } = vi.hoisted(() => ({
  urls: new Map<string, string | null>(),
}));

vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: (fileId: string | undefined) => ({
    data: fileId === undefined ? undefined : (urls.get(fileId) ?? null),
    isLoading: false,
    isError: false,
  }),
  useFileUrls: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock(
  '@/app/features/documents/components/document-preview-dialog-lazy',
  () => ({
    DocumentPreviewDialog: ({
      fileId,
      fileName,
    }: {
      fileId: string;
      fileName: string;
    }) => (
      <div role="dialog" aria-label={`Preview of ${fileName}`}>
        {fileId}
      </div>
    ),
    warmDocumentPreviewDialog: () => undefined,
  }),
);

/** The picture `generate_image` stored for this reply. */
const NOOK: MessagePart = {
  type: 'artifact',
  fileId: 's3:acme/9dc99bab',
  name: 'cozy-reading-nook.jpg',
  mediaType: 'image/jpeg',
  sizeBytes: 412_000,
  callId: 'call_1',
};

/** The file `create_file` stored for this reply. */
const TABLE: MessagePart = {
  type: 'artifact',
  fileId: 's3:acme/1f2e',
  name: 'planets.csv',
  mediaType: 'text/csv',
  sizeBytes: 96,
  callId: 'call_2',
};

function renderReply(text: string, parts: readonly MessagePart[] = []) {
  return render(
    <MessageMarkdown text={text} parts={parts} isStreaming={false} />,
  );
}

beforeEach(() => {
  urls.clear();
});

describe('a reply that names a stored file in its text [CHAT-R40]', () => {
  it('does not draw a picture the reply carries a second time', () => {
    const { container } = renderReply(
      'Here is your cozy reading nook with plants:\n\n![Cozy Reading Nook](s3:acme/9dc99bab)\n\nThe image has been generated and attached (1264 × 848 px).',
      [NOOK],
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText('Cozy Reading Nook')).not.toBeInTheDocument();
    expect(
      screen.getByText(/The image has been generated and attached/),
    ).toBeInTheDocument();
  });

  it('draws another stored picture the reader may open from its signed link', () => {
    urls.set('s3:acme/earlier', 'https://store.example/earlier.png?sig=1');
    renderReply('The one from before:\n\n![Lighthouse](s3:acme/earlier)', [
      NOOK,
    ]);
    expect(screen.getByRole('img', { name: 'Lighthouse' })).toHaveAttribute(
      'src',
      'https://store.example/earlier.png?sig=1',
    );
  });

  it('reads a stored picture the reader may not open as its words', () => {
    const { container } = renderReply('![Lighthouse](s3:acme/someone-else)');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Lighthouse')).toBeInTheDocument();
    expect(screen.getByText("(This image can't be shown.)")).toHaveClass(
      'sr-only',
    );
  });

  it('opens the preview of a stored file the text links to', () => {
    renderReply('Download [planets.csv](s3:acme/1f2e) when you need it.', [
      TABLE,
    ]);
    // It opens a preview, so it is a button: no address to open in a tab.
    expect(screen.queryByRole('link', { name: 'planets.csv' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'planets.csv' }));
    expect(
      screen.getByRole('dialog', { name: 'Preview of planets.csv' }),
    ).toHaveTextContent('s3:acme/1f2e');
  });

  it('reads an image whose address no browser loads as its words, never a placeholder', () => {
    const { container } = renderReply('![A chart](foo:bar) and ![](s3:)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(screen.getByText('A chart')).toBeInTheDocument();
  });

  it('keeps a web picture a picture that opens the preview', () => {
    renderReply('![Logo](https://cdn.example/logo.png)');
    const picture = screen.getByRole('img', { name: 'Logo' });
    expect(picture).toHaveAttribute('src', 'https://cdn.example/logo.png');
    fireEvent.click(picture);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reads a web picture that fails to load as its words', () => {
    const { container } = renderReply('![Logo](https://cdn.example/gone.png)');
    const picture = screen.getByRole('img', { name: 'Logo' });
    fireEvent.error(picture);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Logo')).toBeInTheDocument();
  });
});
