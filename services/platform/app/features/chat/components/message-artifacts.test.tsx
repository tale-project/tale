/**
 * The files a reply produced render below the answer: a document as a card
 * that opens the in-app preview with a download beside it that keeps the
 * file's name, an image as a picture that opens the gallery.
 */

import { formatFileSize } from '@tale/ui/format';
import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import { artifactsOf, MessageArtifacts } from './message-artifacts';

const { urls } = vi.hoisted(() => ({
  urls: {
    data: undefined as { fileId: string; url: string }[] | undefined,
  },
}));

vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrls: () => urls,
}));
vi.mock(
  '@/app/features/documents/components/document-preview-dialog-lazy',
  () => ({
    DocumentPreviewDialog: ({ fileName }: { fileName: string }) => (
      <div role="dialog" aria-label={`Preview of ${fileName}`} />
    ),
    warmDocumentPreviewDialog: () => undefined,
  }),
);

const SHEET: MessagePart = {
  type: 'artifact',
  fileId: 's3:acme/sheet',
  name: 'planets.xlsx',
  mediaType:
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  sizeBytes: 4935,
  callId: 'call_1',
};

const IMAGE: MessagePart = {
  type: 'artifact',
  fileId: 's3:acme/lighthouse',
  name: 'lighthouse.png',
  mediaType: 'image/png',
  sizeBytes: 412_000,
};

function filesSection() {
  return screen.getByRole('region', { name: 'Files from this reply' });
}

describe('MessageArtifacts', () => {
  it('renders nothing for a reply that made no file', () => {
    const { container } = render(
      <MessageArtifacts
        parts={[{ type: 'text', text: 'Done.' }]}
        organizationId="org-1"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a document as a card that opens its preview', async () => {
    urls.data = [];
    const { user } = render(
      <MessageArtifacts
        parts={[{ type: 'text', text: 'Here it is.' }, SHEET]}
        organizationId="org-1"
      />,
    );
    const section = filesSection();
    expect(within(section).getByText('planets.xlsx')).toBeVisible();
    expect(
      within(section).getByText(`XLSX · ${formatFileSize(4935)}`),
    ).toBeVisible();

    await user.click(
      within(section).getByRole('button', { name: 'Open planets.xlsx' }),
    );
    expect(
      screen.getByRole('dialog', { name: 'Preview of planets.xlsx' }),
    ).toBeInTheDocument();
  });

  it('downloads a document under its own name through the files door', () => {
    urls.data = [];
    render(<MessageArtifacts parts={[SHEET]} organizationId="org-1" />);
    const download = within(filesSection()).getByRole('link', {
      name: 'Download planets.xlsx',
    });
    expect(download).toHaveAttribute('download');
    const href = new URL(
      download.getAttribute('href') ?? '',
      'http://tale.test',
    );
    expect(href.pathname).toBe('/api/app/files/serve');
    expect(href.searchParams.get('ref')).toBe('s3:acme/sheet');
    expect(href.searchParams.get('filename')).toBe('planets.xlsx');
    expect(href.searchParams.get('orgId')).toBe('org-1');
  });

  it('shows an image as a picture that opens the gallery', async () => {
    urls.data = [
      { fileId: 's3:acme/lighthouse', url: 'https://cdn.test/l.png' },
    ];
    const { user } = render(
      <MessageArtifacts parts={[IMAGE]} organizationId="org-1" />,
    );
    expect(
      within(filesSection()).getByRole('img', { name: 'lighthouse.png' }),
    ).toHaveAttribute('src', 'https://cdn.test/l.png');

    await user.click(
      within(filesSection()).getByRole('button', {
        name: 'View lighthouse.png',
      }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the name of an image whose bytes cannot be shown', () => {
    urls.data = [];
    render(<MessageArtifacts parts={[IMAGE]} organizationId="org-1" />);
    expect(within(filesSection()).getByText('lighthouse.png')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('artifactsOf', () => {
  it('lists each produced file once, in the order it was made', () => {
    expect(
      artifactsOf([
        IMAGE,
        { type: 'text', text: 'and' },
        SHEET,
        { ...SHEET, callId: 'call_2' },
      ]).map((part) => part.name),
    ).toEqual(['lighthouse.png', 'planets.xlsx']);
  });
});
