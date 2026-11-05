// @vitest-environment jsdom
/**
 * The hook that decides the composer's send gate for staged documents, and
 * the feedback a person sees about them.
 *
 * A document is read for the assistant on a worker right after its upload,
 * in seconds, and a message waits for that read — never for the search
 * index, unless the document is too large to read before it. The customer
 * case this guards: two PDFs staged in one message sat at "Indexing…" behind
 * an indexing backlog, and the message could not be sent. The gate itself is
 * asserted in `chat-surface.test.tsx`; what matters here is when the hook
 * reports a document the send must wait for, and which outcomes reach the
 * person as a toast — each once, however often the composer remounts.
 */

import { toast } from '@tale/ui/use-toast';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileAttachment } from '@/app/features/shared/files/types';

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
// Keys, with their values, in place of the words: what is said, not how.
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key} ${JSON.stringify(values)}`,
  }),
}));

// The read is HTTP: the mock serves the seeded rows as `data`.
const seeded: { rows: unknown } = { rows: undefined };
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: (options: { enabled?: boolean }) => ({
    data: options.enabled === false ? undefined : seeded.rows,
  }),
}));
vi.mock('../data/chat-backend', () => ({
  useChatQueryClient: () => ({}),
}));

const { forgetToldVerdictsForTests, useFileIndexingStatus } =
  await import('./use-file-indexing-status');

const ORG = 'org-1';

const PDF: FileAttachment = {
  fileId: 'doc-1',
  fileName: 'ticket.pdf',
  fileType: 'application/pdf',
  fileSize: 400 * 1024,
};
const IMAGE: FileAttachment = {
  fileId: 'img-1',
  fileName: 'photo.png',
  fileType: 'image/png',
  fileSize: 1024,
};

/** The statuses row of the PDF: its read, then its index. */
function row(textStatus: string | undefined, ragStatus: string, extra = {}) {
  return {
    storageId: PDF.fileId,
    fileName: PDF.fileName,
    contentType: PDF.fileType,
    size: PDF.fileSize,
    ...(textStatus !== undefined ? { textStatus } : {}),
    ragStatus,
    ...extra,
  };
}

const toastMock = vi.mocked(toast);

beforeEach(() => {
  seeded.rows = undefined;
  toastMock.mockClear();
  forgetToldVerdictsForTests();
});

describe('useFileIndexingStatus — the send gate [CHAT-R47]', () => {
  it('holds a send while a document is read', () => {
    for (const textStatus of ['queued', 'running']) {
      seeded.rows = [row(textStatus, 'queued')];
      const { result } = renderHook(() => useFileIndexingStatus([PDF], ORG));
      expect(result.current.waitingForDocuments).toBe(true);
    }
  });

  it('never holds a send once the read is decided, however the index stands', () => {
    for (const textStatus of ['ready', 'refused', 'unreadable']) {
      for (const ragStatus of ['queued', 'running', 'failed']) {
        seeded.rows = [row(textStatus, ragStatus)];
        const { result } = renderHook(() => useFileIndexingStatus([PDF], ORG));
        expect(result.current.waitingForDocuments).toBe(false);
      }
    }
  });

  it('holds a send for the index of a document too large to read before it', () => {
    seeded.rows = [row('deferred', 'running')];
    const { result } = renderHook(() => useFileIndexingStatus([PDF], ORG));
    expect(result.current.waitingForDocuments).toBe(true);
    seeded.rows = [row('deferred', 'completed')];
    const { result: done } = renderHook(() =>
      useFileIndexingStatus([PDF], ORG),
    );
    expect(done.current.waitingForDocuments).toBe(false);
  });

  it('holds it while a document’s status has not answered yet, and only then', () => {
    seeded.rows = undefined;
    const { result } = renderHook(() => useFileIndexingStatus([PDF], ORG));
    expect(result.current.waitingForDocumentsUnknown).toBe(true);
    const { result: noDocs } = renderHook(() =>
      useFileIndexingStatus([IMAGE], ORG),
    );
    expect(noDocs.current.waitingForDocumentsUnknown).toBe(false);
    expect(noDocs.current.waitingForDocuments).toBe(false);
  });
});

describe('useFileIndexingStatus — feedback', () => {
  /** Render the hook over a sequence of statuses; the toasts it fired. */
  function watch(...states: unknown[][]) {
    seeded.rows = states[0];
    const hook = renderHook(() => useFileIndexingStatus([PDF], ORG));
    for (const state of states.slice(1)) {
      seeded.rows = state;
      hook.rerender();
    }
    return toastMock.mock.calls.map(([call]) => call);
  }

  it('confirms the upload once the read it watched is ready', () => {
    expect(watch([row('running', 'queued')], [row('ready', 'queued')])).toEqual(
      [
        {
          title: 'fileUploaded',
          description: 'uploadedSuccessfully {"filename":"ticket.pdf"}',
        },
      ],
    );
  });

  it('confirms nothing for a document seen ready from the start — a remount, a restored draft', () => {
    expect(watch([row('ready', 'running')])).toEqual([]);
  });

  it('says nothing when only the search index of a read document fails', () => {
    expect(
      watch(
        [row('running', 'queued')],
        [row('ready', 'running')],
        [row('ready', 'failed', { ragErrorCode: 'embedding_upstream' })],
      ),
    ).toHaveLength(1);
  });

  it.each([
    ['secret_detected', 'documentRefusedSecret'],
    ['pii_blocked', 'documentRefusedPii'],
    ['pii_scan_failed', 'documentRefusedPiiUnscanned'],
  ])(
    'says the assistant cannot read a file the organization refuses (%s)',
    (code, detail) => {
      expect(
        watch(
          [row('running', 'queued')],
          [row('refused', 'queued', { textErrorCode: code })],
        ),
      ).toEqual([
        {
          title: 'documentRefused',
          description: `${detail} {"filename":"ticket.pdf"}`,
          variant: 'destructive',
        },
      ]);
    },
  );

  it('tells a refusal it first sees once per page, never again on a remount', () => {
    seeded.rows = [row('refused', 'queued', { textErrorCode: 'pii_blocked' })];
    renderHook(() => useFileIndexingStatus([PDF], ORG));
    renderHook(() => useFileIndexingStatus([PDF], ORG));
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['empty', 'documentNoText', 'documentNoTextDescription'],
    ['malformed', 'documentMalformed', 'documentMalformedDescription'],
  ])(
    'gives a heads-up for a file with no readable text (%s)',
    (code, title, detail) => {
      expect(
        watch(
          [row('running', 'queued')],
          [row('unreadable', 'queued', { textErrorCode: code })],
        ),
      ).toEqual([
        { title, description: `${detail} {"filename":"ticket.pdf"}` },
      ]);
    },
  );

  it('reports a failed index the send was waiting for', () => {
    expect(
      watch(
        [row('deferred', 'running')],
        [row('deferred', 'failed', { ragErrorCode: 'embedding_upstream' })],
      ),
    ).toEqual([
      {
        title: 'indexingFailed',
        description: 'indexingFailedDescription {"filename":"ticket.pdf"}',
        variant: 'destructive',
      },
    ]);
  });

  it('confirms the upload of a document whose send waited for its index', () => {
    expect(
      watch([row('deferred', 'running')], [row('deferred', 'completed')]),
    ).toEqual([
      {
        title: 'fileUploaded',
        description: 'uploadedSuccessfully {"filename":"ticket.pdf"}',
      },
    ]);
  });

  it('gives a heads-up for a format no extractor reads, even seen first', () => {
    expect(
      watch([
        row(undefined, 'unsupported', { ragErrorCode: 'unsupported_type' }),
      ]),
    ).toEqual([
      {
        title: 'indexingUnsupported',
        description: 'indexingUnsupportedDescription {"filename":"ticket.pdf"}',
      },
    ]);
  });
});
