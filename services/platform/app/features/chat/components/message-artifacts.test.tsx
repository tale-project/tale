/**
 * The files a reply produced render below the answer: a document as a card
 * that opens the in-app preview with a download beside it that keeps the
 * file's name, a picture as a picture that opens the gallery. An SVG, and a
 * picture that cannot be shown, get the card.
 */

import { formatFileSize } from '@tale/ui/format';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, within } from '@/tests/utils/render';

import type { MessagePart } from '../types';
import { artifactsOf, MessageArtifacts } from './message-artifacts';

const { urls } = vi.hoisted(() => ({
  urls: {
    data: undefined as { fileId: string; url: string | null }[] | undefined,
    isLoading: false,
    isError: false,
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

/** What `create_file` stores for a typed-out SVG (#5028). */
const SVG: MessagePart = {
  type: 'artifact',
  fileId: 's3:acme/gasse',
  name: 'superheld-dunkle-gasse.svg',
  mediaType: 'image/svg+xml',
  sizeBytes: 2_048,
  callId: 'call_svg',
};

function filesSection() {
  return screen.getByRole('region', { name: 'Files from this reply' });
}

/** The card of the file `name`: it opens the preview and downloads. */
function expectCard(name: string) {
  const section = filesSection();
  expect(
    within(section).getByRole('button', { name: `Open ${name}` }),
  ).toBeVisible();
  expect(
    within(section).getByRole('link', { name: `Download ${name}` }),
  ).toHaveAttribute('download');
}

beforeEach(() => {
  urls.data = undefined;
  urls.isLoading = false;
  urls.isError = false;
});

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

  it('shows an SVG the reply made as a card, not as a picture [CHAT-R33]', async () => {
    // An SVG drawn as a picture sizes itself from its markup: one that
    // names no width collapsed to nothing, one that does not parse drew a
    // broken image, and neither had a Download (#5028).
    urls.data = [{ fileId: 's3:acme/gasse', url: 'https://cdn.test/g.svg' }];
    const { user } = render(
      <MessageArtifacts parts={[SVG]} organizationId="org-1" />,
    );
    expectCard('superheld-dunkle-gasse.svg');
    expect(
      within(filesSection()).getByText(`SVG · ${formatFileSize(2_048)}`),
    ).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    await user.click(
      within(filesSection()).getByRole('button', {
        name: 'Open superheld-dunkle-gasse.svg',
      }),
    );
    expect(
      screen.getByRole('dialog', {
        name: 'Preview of superheld-dunkle-gasse.svg',
      }),
    ).toBeInTheDocument();
  });

  it('holds the place of a picture whose link is on its way', () => {
    urls.isLoading = true;
    render(<MessageArtifacts parts={[IMAGE]} organizationId="org-1" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Open lighthouse.png' }),
    ).not.toBeInTheDocument();
  });

  it('gives a picture whose bytes cannot be shown its card [CHAT-R33]', () => {
    urls.data = [{ fileId: 's3:acme/lighthouse', url: null }];
    render(<MessageArtifacts parts={[IMAGE]} organizationId="org-1" />);
    expectCard('lighthouse.png');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('turns a picture that fails to load into its card [CHAT-R33]', () => {
    urls.data = [
      { fileId: 's3:acme/lighthouse', url: 'https://cdn.test/l.png' },
    ];
    render(<MessageArtifacts parts={[IMAGE]} organizationId="org-1" />);
    fireEvent.error(
      within(filesSection()).getByRole('img', { name: 'lighthouse.png' }),
    );
    expectCard('lighthouse.png');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('gives the pictures their cards when their links cannot be read [CHAT-R33]', () => {
    urls.isError = true;
    render(<MessageArtifacts parts={[IMAGE]} organizationId="org-1" />);
    expectCard('lighthouse.png');
  });

  it('keeps the name of a picture whose bytes cannot be shown where no organization is open', () => {
    urls.data = [];
    render(<MessageArtifacts parts={[IMAGE]} />);
    expect(within(filesSection()).getByText('lighthouse.png')).toBeVisible();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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
