// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';

import { useChatVideoLinks } from './use-chat-video-links';

// ---------------------------------------------------------------------------
// Regression coverage for the silent retry click.
//
// `retryVideoLink` refuses retries with structured ConvexError codes — the
// 15-minute bot-detection/rate-limit cooldown (`retryCooldown`), budget and
// in-flight caps — and the chip's onRetry discards the returned promise.
// `retryJob` used to await the mutation with no catch, so the refusal became
// an unhandled rejection: the user clicked retry on a bot-walled video and
// nothing visibly happened, while the `videoLink.errors.retryCooldown` copy
// sat unreachable in the locale files. `retryJob` now surfaces the refusal
// through the same toast contract as `ingestUrlsFromText`.
// ---------------------------------------------------------------------------

// The hook calls useMutation three times in fixed order (ingest, cancel,
// retry — see use-chat-video-links.ts). A cycling dispatcher keeps the
// mapping stable across re-renders.
const mutationFns = [vi.fn(), vi.fn(), vi.fn()];
let mutationCallIdx = 0;
const retryFn = mutationFns[2];

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => undefined),
  useMutation: vi.fn(() => mutationFns[mutationCallIdx++ % 3]),
}));

vi.mock('@/app/hooks/use-toast', () => ({ toast: vi.fn() }));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

const toastMock = vi.mocked(toast);

const JOB_ID = 'job-1' as Id<'videoLinkJobs'>;

function renderRetryJob() {
  const { result } = renderHook(() =>
    useChatVideoLinks({ threadId: undefined, organizationId: 'org-1' }),
  );
  return result.current.retryJob;
}

describe('useChatVideoLinks retryJob error surfacing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('toasts the mapped copy when the mutation refuses with a structured code', async () => {
    retryFn.mockRejectedValueOnce(
      new ConvexError({
        code: 'retryCooldown',
        message: 'wait a few minutes',
      }),
    );
    const retryJob = renderRetryJob();

    // Must resolve, not reject — the chip's onRetry discards the promise,
    // so a rethrow would be an unhandled rejection again.
    await expect(retryJob(JOB_ID)).resolves.toBeUndefined();

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({
      title: 'videoLink.toast.retryFailedTitle',
      description: 'videoLink.errors.retryCooldown',
      variant: 'destructive',
    });
  });

  it('falls back to the generic copy on an unstructured error', async () => {
    retryFn.mockRejectedValueOnce(new Error('network blip'));
    const retryJob = renderRetryJob();

    await expect(retryJob(JOB_ID)).resolves.toBeUndefined();

    expect(toastMock).toHaveBeenCalledWith({
      title: 'videoLink.toast.retryFailedTitle',
      description: 'videoLink.errors.generic',
      variant: 'destructive',
    });
  });

  it('stays silent when the retry succeeds', async () => {
    retryFn.mockResolvedValueOnce(undefined);
    const retryJob = renderRetryJob();

    await retryJob(JOB_ID);

    expect(toastMock).not.toHaveBeenCalled();
    expect(retryFn).toHaveBeenCalledWith({ jobId: JOB_ID });
  });
});
