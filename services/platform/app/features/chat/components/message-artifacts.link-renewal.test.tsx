/**
 * A reply's pictures in a chat that stays open (#5366). Each picture draws
 * from a presigned link that runs out after `FILE_LINK_LIFETIME_SEC`, and
 * the store answers it with 403 from then on. The picture already drawn
 * kept showing, but its preview loaded the dead link, showed a broken
 * image, and nothing asked for a new one. The read lane runs for real here
 * (the batch of links, `backendFetch`, react-query) against a closed
 * synthetic transport that signs a new link on every call. A link that no
 * longer loads is the picture's `error` event, which jsdom never fires by
 * itself.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import type { MessagePart } from '../types';
import { MessageArtifacts } from './message-artifacts';

vi.mock(
  '@/app/features/documents/components/document-preview-dialog-lazy',
  () => ({
    DocumentPreviewDialog: ({ fileName }: { fileName: string }) => (
      <div role="dialog" aria-label={`Preview of ${fileName}`} />
    ),
    warmDocumentPreviewDialog: () => undefined,
  }),
);

const URLS = /^POST \/api\/app\/files\/urls\?orgId=org-1$/;

const IMAGE: MessagePart = {
  type: 'artifact',
  fileId: 's3:acme/lighthouse',
  name: 'lighthouse.png',
  mediaType: 'image/png',
  sizeBytes: 412_000,
};

/** The link to the picture that the store's `n`th answer signed. */
const link = (n: number) => `https://store.test/s3:acme/lighthouse?signed=${n}`;

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/chat');
  backend = syntheticBackend();
  let answers = 0;
  backend.on(URLS, (_url, init) => {
    answers += 1;
    const { fileIds } = (
      typeof init?.body === 'string' ? JSON.parse(init.body) : { fileIds: [] }
    ) as { fileIds: string[] };
    return Response.json({
      urls: fileIds.map((fileId) => ({
        fileId,
        url: `https://store.test/${fileId}?signed=${answers}`,
      })),
    });
  });
  // No backoff between the attempts of a renewal that fails: the read lane
  // tries a fault four times before it settles.
  client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

function renderReply() {
  return render(
    <QueryClientProvider client={client}>
      <MessageArtifacts parts={[IMAGE]} organizationId="org-1" />
    </QueryClientProvider>,
  );
}

function filesSection() {
  return screen.getByRole('region', { name: 'Files from this reply' });
}

function picture() {
  return within(filesSection()).getByRole('img', { name: 'lighthouse.png' });
}

/** The picture drew from the store's first link. */
async function drawn() {
  await waitFor(() => expect(picture()).toHaveAttribute('src', link(1)));
}

describe('MessageArtifacts when a link no longer loads', () => {
  it('holds the picture while a new link is on its way, then draws from it [CHAT-R33]', async () => {
    renderReply();
    await drawn();

    // The store no longer serves the link the picture drew from.
    fireEvent.error(picture());
    expect(within(filesSection()).getByRole('status')).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(
      screen.queryByRole('button', { name: 'Open lighthouse.png' }),
    ).not.toBeInTheDocument();

    await waitFor(() => expect(picture()).toHaveAttribute('src', link(2)));
    expect(backend.count(URLS)).toBe(2);
  });

  it('shows the preview from a new link when the old one has run out [CHAT-R33]', async () => {
    const { user } = renderReply();
    await drawn();
    await user.click(
      within(filesSection()).getByRole('button', {
        name: 'View lighthouse.png',
      }),
    );
    const preview = screen.getByRole('dialog', { name: 'Image preview' });
    const shown = () =>
      within(preview).getByRole('img', { name: 'lighthouse.png' });
    expect(shown()).toHaveAttribute('src', link(1));

    // The chat stayed open past the link's lifetime: the preview's load is
    // the first to meet the store's 403, while the reply's picture still
    // shows what it drew.
    fireEvent.error(shown());

    await waitFor(() => expect(shown()).toHaveAttribute('src', link(2)));
    expect(backend.count(URLS)).toBe(2);
  });

  it('gives the picture its card when a new link does not draw either [CHAT-R33]', async () => {
    renderReply();
    await drawn();
    fireEvent.error(picture());
    await waitFor(() => expect(picture()).toHaveAttribute('src', link(2)));

    // A link signed a moment ago has not run out: the bytes are no picture
    // after all, or gone, and asking again would not help.
    fireEvent.error(picture());

    expect(
      within(filesSection()).getByRole('button', {
        name: 'Open lighthouse.png',
      }),
    ).toBeVisible();
    expect(within(filesSection()).queryByRole('img')).not.toBeInTheDocument();
    expect(backend.count(URLS)).toBe(2);
  });

  it('gives the picture its card when no new link can be had [CHAT-R33]', async () => {
    renderReply();
    await drawn();
    backend.on(URLS, serviceUnavailable);

    fireEvent.error(picture());

    expect(
      await within(filesSection()).findByRole('button', {
        name: 'Open lighthouse.png',
      }),
    ).toBeVisible();
    expect(within(filesSection()).queryByRole('img')).not.toBeInTheDocument();
    expect(backend.count(URLS)).toBeGreaterThan(1);
  });
});
