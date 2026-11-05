/**
 * The pictures a person attached to a message, in a chat that stays open
 * (#5366). A thumbnail and its preview draw from a presigned link that runs
 * out after `FILE_LINK_LIFETIME_SEC`, and the store answers it with 403
 * from then on: a thumbnail drawn again after that, and its preview, showed
 * a broken image. The read lane runs for real here (the batch of links,
 * `backendFetch`, react-query) against a closed synthetic transport that
 * signs a new link on every call. A link that no longer loads is the
 * picture's `error` event, which jsdom never fires by itself.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { AttachmentPreviewProvider } from '../hooks/attachment-preview-context';
import type { MessagePart } from '../types';
import { MessageParts } from './message-parts';

const URLS = /^POST \/api\/app\/files\/urls\?orgId=org-1$/;

const IMAGE_PART: MessagePart = {
  type: 'attachment',
  name: 'shot.png',
  mediaType: 'image/png',
  fileId: 'blob1',
  sizeBytes: 4096,
};

/** The link to the picture that the store's `n`th answer signed. */
const link = (n: number) => `https://store.test/blob1?signed=${n}`;

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
  client = new QueryClient();
});

afterEach(() => {
  client.clear();
  vi.restoreAllMocks();
});

function renderMessage(previews?: Map<string, string>) {
  const message = (
    <QueryClientProvider client={client}>
      <MessageParts parts={[{ type: 'text', text: 'look' }, IMAGE_PART]} />
    </QueryClientProvider>
  );
  return render(
    previews === undefined ? (
      message
    ) : (
      <AttachmentPreviewProvider value={previews}>
        {message}
      </AttachmentPreviewProvider>
    ),
  );
}

/** The thumbnail's picture. */
function thumbnail() {
  const picture = screen
    .getByRole('button', { name: 'View image' })
    .querySelector('img');
  if (picture === null) throw new Error('the thumbnail draws no picture');
  return picture;
}

/** The thumbnail drew from the store's first link. */
async function drawn() {
  await waitFor(() => expect(thumbnail()).toHaveAttribute('src', link(1)));
}

describe('MessageParts when a link no longer loads', () => {
  it('draws the thumbnail again from a new link', async () => {
    renderMessage();
    await drawn();

    fireEvent.error(thumbnail());

    await waitFor(() => expect(thumbnail()).toHaveAttribute('src', link(2)));
    expect(backend.count(URLS)).toBe(2);
  });

  it('gives the picture its file chip when a new link does not draw either', async () => {
    renderMessage();
    await drawn();
    fireEvent.error(thumbnail());
    await waitFor(() => expect(thumbnail()).toHaveAttribute('src', link(2)));

    // Never a broken picture: a link signed a moment ago that does not draw
    // has not run out, and asking again would not help.
    fireEvent.error(thumbnail());

    expect(
      screen.queryByRole('button', { name: 'View image' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('shot.png')).toBeVisible();
    expect(backend.count(URLS)).toBe(2);
  });

  it('shows the preview from a new link when the old one has run out', async () => {
    const { user } = renderMessage();
    await drawn();
    await user.click(screen.getByRole('button', { name: 'View image' }));
    const preview = screen.getByRole('dialog', { name: 'Image preview' });
    const shown = () => preview.querySelector('img[alt="shot.png"]');
    expect(shown()).toHaveAttribute('src', link(1));

    fireEvent.error(shown() ?? preview);

    await waitFor(() => expect(shown()).toHaveAttribute('src', link(2)));
    expect(backend.count(URLS)).toBe(2);
  });

  it('gives a picture sent from this page its chip when it does not draw, without asking for links', async () => {
    renderMessage(new Map([['blob1', 'blob:local-preview']]));
    await waitFor(() => expect(backend.count(URLS)).toBe(1));
    expect(thumbnail()).toHaveAttribute('src', 'blob:local-preview');

    // The page's own copy of the bytes is gone; a new link to the store's
    // copy is not what it drew from.
    fireEvent.error(thumbnail());

    expect(
      screen.queryByRole('button', { name: 'View image' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('shot.png')).toBeVisible();
    expect(backend.count(URLS)).toBe(1);
  });
});
