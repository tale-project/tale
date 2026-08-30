// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// One parked send carrying a still-indexing document and a FAILED video job:
// the row must show the document's live indexing state and the failed chip's
// error + Try again — the exact states the readiness watcher waits on.
const listState: { rows: unknown[]; jobs: unknown[] } = { rows: [], jobs: [] };
const cancelMock = vi.hoisted(() =>
  vi.fn((..._args: [string, string]) => Promise.resolve(true)),
);
const retryMock = vi.hoisted(() =>
  vi.fn((..._args: [string, string]) => Promise.resolve()),
);

// The tray reads over HTTP now: react-query rows keyed by the backend
// vocabulary — the entity slot tells the two reads apart.
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { queryKey?: unknown[] }) =>
    Array.isArray(options?.queryKey) && options.queryKey[2] === 'video_link'
      ? { data: listState.jobs }
      : { data: listState.rows },
}));
vi.mock('@/app/lib/backend/chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/chat')>()),
  cancelDeferredSendRequest: (organizationId: string, deferredSendId: string) =>
    cancelMock(organizationId, deferredSendId),
  retryVideoLinkRequest: (organizationId: string, jobId: string) =>
    retryMock(organizationId, jobId),
}));
vi.mock('../data/chat-backend', () => ({
  useChatQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../hooks/use-file-indexing-status', () => ({
  useFileIndexingStatus: () => ({
    statusMap: new Map([
      ['blob_doc', { status: 'running', progress: 'extracting 30/60' }],
    ]),
    isIndexing: true,
    isQueryLoading: false,
  }),
}));
vi.mock('../hooks/use-file-transcription-status', () => ({
  useFileTranscriptionStatus: () => ({
    statusMap: new Map(),
    isTranscribing: false,
    isQueryLoading: false,
  }),
}));

import { DeferredSendTray } from './deferred-send-tray';

afterEach(() => {
  listState.rows = [];
  listState.jobs = [];
  cancelMock.mockClear();
  retryMock.mockClear();
});

function seedRow() {
  listState.rows = [
    {
      deferredSendId: 'defer_1',
      userText: '解读下这个视频',
      attachments: [
        {
          fileId: 'blob_doc',
          fileName: 'handbook.pdf',
          fileType: 'application/pdf',
          fileSize: 2048,
        },
      ],
      videoJobIds: ['job_1'],
      status: 'waiting',
      createdAt: 1,
    },
  ];
  listState.jobs = [
    {
      jobId: 'job_1',
      sourceUrl: 'https://youtu.be/abc',
      sourcePlatform: 'youtube',
      pastedToken: 'https://youtu.be/abc',
      videoTitle: 'Keynote',
      displayStatus: 'failed',
      errorReasonCode: 'botDetection',
      uploadedBy: 'user1',
      createdAt: 0,
    },
  ];
}

describe('DeferredSendTray', () => {
  it('shows each parked medium with live status — including a failed video with retry', async () => {
    seedRow();
    const { user } = render(
      <DeferredSendTray
        organizationId="org-1"
        threadId="thread-1"
        onRestoreText={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Queued — sends when the attachments are ready'),
    ).toBeInTheDocument();
    expect(screen.getByText('解读下这个视频')).toBeInTheDocument();
    // Document: live %-progress from the indexing pipeline.
    expect(screen.getByText('handbook.pdf')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    // Failed video: localized error + Try again wired to the retry mutation.
    expect(screen.getByText('Keynote')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Video platform blocked automated access — try again later or use another platform',
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retryMock).toHaveBeenCalledWith('org-1', 'job_1');
    // The chip's own ✕ is hidden in the tray — the row ✕ owns the cancel.
    expect(
      screen.queryByRole('button', { name: 'Remove' }),
    ).not.toBeInTheDocument();
  });

  it('cancels the whole parked send from the row and restores the text', async () => {
    seedRow();
    const onRestoreText = vi.fn();
    const { user } = render(
      <DeferredSendTray
        organizationId="org-1"
        threadId="thread-1"
        onRestoreText={onRestoreText}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Cancel queued message' }),
    );

    expect(cancelMock).toHaveBeenCalledWith('org-1', 'defer_1');
    await vi.waitFor(() =>
      expect(onRestoreText).toHaveBeenCalledWith('解读下这个视频'),
    );
  });

  it('renders nothing while the queue is empty', () => {
    const { container } = render(
      <DeferredSendTray
        organizationId="org-1"
        threadId="thread-1"
        onRestoreText={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
