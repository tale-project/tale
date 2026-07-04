// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';

import { useFileIndexingStatus } from './use-file-indexing-status';

// ---------------------------------------------------------------------------
// Regression coverage for #1457 — the *firing* half of the deferred toast.
//
// The composer suppresses the immediate "uploaded successfully" toast for
// RAG-indexable files because indexing runs asynchronously and can still
// fail. `useFileIndexingStatus` owns the terminal signal: when a tracked file
// transitions out of a pending state (`queued`/`running`) it fires the
// deferred success toast on `completed`, or the destructive "Index failed"
// toast on `failed`. Keying on the *transition* (not the absolute status)
// keeps a remount of an already-finished file silent and fires the success
// toast exactly once per upload.
//
// The sibling suite `use-convex-file-upload.indexing-toast.cap.test.ts` covers
// the suppression half; this suite covers the firing half (success + the
// previously-untested error branch + the remount-silence guard).
// ---------------------------------------------------------------------------

interface MetadataRow {
  storageId: Id<'_storage'>;
  ragStatus?: 'queued' | 'running' | 'completed' | 'failed';
  ragError?: string;
  ragProgress?: string;
  fileName: string;
}

// Mutable backing value the mocked `useQuery` reads on every render, so a
// rerender can simulate the reactive Convex query observing a new status.
let metadataValue: MetadataRow[] | undefined;

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => metadataValue),
  // Polling action — return a no-op async fn so the effect is inert.
  useAction: vi.fn(() => vi.fn().mockResolvedValue(undefined)),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

const toastMock = vi.mocked(toast);

const STORAGE_ID = 'storage-1' as Id<'_storage'>;

function attachment() {
  return {
    fileId: STORAGE_ID,
    fileName: 'report.pdf',
    fileType: 'application/pdf',
    fileSize: 3,
  };
}

function row(status: MetadataRow['ragStatus']): MetadataRow {
  return { storageId: STORAGE_ID, ragStatus: status, fileName: 'report.pdf' };
}

function successToasts() {
  return toastMock.mock.calls.filter(([arg]) => arg?.title === 'fileUploaded');
}

function failureToasts() {
  return toastMock.mock.calls.filter(
    ([arg]) => arg?.title === 'indexingFailed',
  );
}

beforeEach(() => {
  metadataValue = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useFileIndexingStatus — deferred toast firing (#1457)', () => {
  it('fires the success toast exactly once on queued → completed', () => {
    metadataValue = [row('queued')];
    const { rerender } = renderHook(() =>
      useFileIndexingStatus([attachment()], 'org-1'),
    );
    expect(successToasts()).toHaveLength(0);

    // Indexing finishes.
    metadataValue = [row('completed')];
    rerender();

    expect(successToasts()).toHaveLength(1);
    expect(successToasts()[0]?.[0]).toMatchObject({
      title: 'fileUploaded',
      description: 'uploadedSuccessfully',
    });
    expect(failureToasts()).toHaveLength(0);

    // A further reactive update of the now-terminal file fires nothing more.
    rerender();
    expect(successToasts()).toHaveLength(1);
  });

  it('fires the destructive "Index failed" toast on running → failed', () => {
    metadataValue = [row('running')];
    const { rerender } = renderHook(() =>
      useFileIndexingStatus([attachment()], 'org-1'),
    );
    expect(failureToasts()).toHaveLength(0);

    metadataValue = [row('failed')];
    rerender();

    expect(failureToasts()).toHaveLength(1);
    expect(failureToasts()[0]?.[0]).toMatchObject({
      title: 'indexingFailed',
      description: 'indexingFailedDescription',
      variant: 'destructive',
    });
    expect(successToasts()).toHaveLength(0);
  });

  it('stays silent when the first observed status is already terminal (remount)', () => {
    // A file that finished before this hook ever observed a pending state —
    // e.g. a remount — must not re-announce its outcome.
    metadataValue = [row('completed')];
    const { rerender } = renderHook(() =>
      useFileIndexingStatus([attachment()], 'org-1'),
    );
    rerender();

    expect(successToasts()).toHaveLength(0);
    expect(failureToasts()).toHaveLength(0);
  });
});
