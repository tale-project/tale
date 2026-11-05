/**
 * The pictures attached to a task that stays open (#5366). The preview of a
 * saved picture draws from a presigned link that runs out after
 * `FILE_LINK_LIFETIME_SEC`, and the store answers it with 403 from then on:
 * opened after that, the preview showed a broken image. The read lane runs
 * for real here (the batch of links, `backendFetch`, react-query) against a
 * closed synthetic transport that signs a new link on every call. A link
 * that no longer loads is the picture's `error` event, which jsdom never
 * fires by itself.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { TaskAttachments } from './task-attachments';

// The row's own renderer resolves its thumbnail elsewhere (and needs a live
// Convex provider for audio and video); this test is about the preview. The
// stub's row opens the preview once the task has a link to show in it.
vi.mock('@/app/features/shared/files/file-displays', () => ({
  FileAttachmentDisplay: ({
    attachment,
    onImageClick,
  }: {
    attachment: { fileName: string };
    onImageClick?: () => void;
  }) => (
    <button
      type="button"
      onClick={onImageClick}
      disabled={onImageClick === undefined}
    >
      {attachment.fileName}
    </button>
  ),
}));

const URLS = /^POST \/api\/app\/files\/urls\?orgId=org-1$/;

/** A picture the task saved: no copy on this page, only the store's. */
const PHOTO = {
  fileId: 'storage-1',
  fileName: 'photo.png',
  fileType: 'image/png',
  fileSize: 1024,
};

/** The link to the picture that the store's `n`th answer signed. */
const link = (n: number) => `https://store.test/storage-1?signed=${n}`;

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/tasks');
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

describe('TaskAttachments when a link no longer loads', () => {
  it('shows the preview from a new link when the old one has run out', async () => {
    const { user } = render(
      <QueryClientProvider client={client}>
        <TaskAttachments
          attachments={[PHOTO]}
          uploadingFiles={[]}
          canEdit={false}
          organizationId="org-1"
        />
      </QueryClientProvider>,
    );
    const row = screen.getByRole('button', { name: 'photo.png' });
    await waitFor(() => expect(row).toBeEnabled());
    await user.click(row);
    const preview = screen.getByRole('dialog', { name: 'Image preview' });
    const shown = () => preview.querySelector('img[alt="photo.png"]');
    await waitFor(() => expect(shown()).toHaveAttribute('src', link(1)));

    fireEvent.error(shown() ?? preview);

    await waitFor(() => expect(shown()).toHaveAttribute('src', link(2)));
    expect(backend.count(URLS)).toBe(2);
  });
});
