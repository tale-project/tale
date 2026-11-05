/**
 * A stored picture a reply's text names by its reference, in a chat that
 * stays open (#5366). The picture draws from a presigned link that runs out
 * after `FILE_LINK_LIFETIME_SEC`, and the store answers it with 403 from
 * then on: the picture already drawn kept showing, but its preview loaded
 * the dead link. The read lane runs for real here (the batch of links,
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

import { MessageMarkdown } from './message-markdown';

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

/** A picture of an earlier reply, which this reply names in its text. */
const TEXT = 'The one from before:\n\n![Lighthouse](s3:acme/earlier)';

/** The link to the picture that the store's `n`th answer signed. */
const link = (n: number) => `https://store.test/s3:acme/earlier?signed=${n}`;

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

function renderReply() {
  return render(
    <QueryClientProvider client={client}>
      <MessageMarkdown text={TEXT} parts={[]} isStreaming={false} />
    </QueryClientProvider>,
  );
}

function picture() {
  return screen.getByRole('img', { name: 'Lighthouse' });
}

/** The picture drew from the store's first link. */
async function drawn() {
  await waitFor(() => expect(picture()).toHaveAttribute('src', link(1)));
}

describe("a stored picture in a reply's text when its link no longer loads", () => {
  it('draws the picture again from a new link [CHAT-R40]', async () => {
    renderReply();
    await drawn();

    fireEvent.error(picture());

    await waitFor(() => expect(picture()).toHaveAttribute('src', link(2)));
    expect(backend.count(URLS)).toBe(2);
  });

  it('shows the preview from a new link when the old one has run out [CHAT-R40]', async () => {
    const { user } = renderReply();
    await drawn();
    await user.click(picture());
    const preview = screen.getByRole('dialog', { name: 'Image preview' });
    const shown = () => preview.querySelector('img[alt="Lighthouse"]');
    expect(shown()).toHaveAttribute('src', link(1));

    fireEvent.error(shown() ?? preview);

    await waitFor(() => expect(shown()).toHaveAttribute('src', link(2)));
    expect(backend.count(URLS)).toBe(2);
  });

  it('reads the picture as its words when a new link does not draw either [CHAT-R40]', async () => {
    const { container } = renderReply();
    await drawn();
    fireEvent.error(picture());
    await waitFor(() => expect(picture()).toHaveAttribute('src', link(2)));

    // A link signed a moment ago has not run out: asking again would not
    // help.
    fireEvent.error(picture());

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Lighthouse')).toBeInTheDocument();
    expect(backend.count(URLS)).toBe(2);
  });
});
