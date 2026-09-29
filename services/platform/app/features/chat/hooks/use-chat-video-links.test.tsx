// @vitest-environment jsdom
/**
 * The composer's video chips, as ChatSurface wires them: the real hook, the
 * real chip and the real toaster, each callback fired and forgotten. Only
 * `fetch` is stubbed, with the answers the `/api/app/video-links` routes
 * give (`routes.ts`, the org-member gate in `auth/org.ts`), so the request
 * adapter reads every refusal the way it reads a live one.
 *
 * A refused **Remove** used to put the chip back with no word of why: the
 * hook logged and rethrew, and ChatSurface dropped the promise (#3720). It
 * now says so the way a refused **Try again** always did, and both read the
 * failure the same way.
 */
import '@testing-library/jest-dom/vitest';
import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { VideoLinkChip } from '../components/video-link-chip';
import { useChatVideoLinks, type VideoLinkJob } from './use-chat-video-links';

vi.mock('@tale/ui/use-toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tale/ui/use-toast')>();
  return { ...actual, toast: vi.fn(actual.toast) };
});

const ORG = 'org-1';
const THREAD = 'thread-a';

/** A chip row as the thread read answers it. */
function jobView(overrides: Partial<VideoLinkJob> = {}): VideoLinkJob {
  return {
    jobId: 'job-1',
    sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    sourcePlatform: 'youtube',
    pastedToken: 'https://www.youtube.com/watch?v=abcdefghijk',
    videoTitle: 'Shipment call',
    displayStatus: 'queued',
    uploadedBy: 'user-1',
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The org-member gate's answer once the membership is gone. */
const NOT_A_MEMBER = (): Response =>
  json(
    { error: 'ORG_FORBIDDEN', message: `Not a member of organization ${ORG}` },
    403,
  );

type Answer = () => Response | Promise<Response>;

interface Backend {
  jobs: VideoLinkJob[];
  /** Answers for successive cancel / retry calls, in order. */
  cancel: Answer[];
  retry: Answer[];
  calls: string[];
}

function pathOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof Request ? input.url : input.href;
}

/** `fetch` as the video-link routes answer it. A cancel that succeeds skips
 * the job, as the service does, so the next read drops the chip. */
function stubBackend(backend: Backend): void {
  vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
    const path = pathOf(input);
    const method = init?.method ?? 'GET';
    backend.calls.push(`${method} ${path}`);
    if (
      method === 'GET' &&
      path === `/api/app/video-links/thread/${THREAD}?orgId=${ORG}`
    ) {
      return json({ jobs: backend.jobs });
    }
    const write =
      /^\/api\/app\/video-links\/([^/]+)\/(cancel|retry)\?orgId=/.exec(path);
    if (method === 'POST' && write) {
      const [, jobId, verb] = write;
      const answer = (
        verb === 'cancel' ? backend.cancel : backend.retry
      ).shift();
      if (answer === undefined) throw new Error(`unscripted ${verb}`);
      const response = await answer();
      if (verb === 'cancel' && response.ok) {
        backend.jobs = backend.jobs.map((job) =>
          job.jobId === jobId ? { ...job, displayStatus: 'skipped' } : job,
        );
      }
      return response;
    }
    return json({ error: 'Not Found' }, 404);
  });
}

/** The chip row as ChatSurface wires it: `void` on both callbacks. */
function ChipRow() {
  const videoLinks = useChatVideoLinks({
    threadId: THREAD,
    organizationId: ORG,
    locale: 'en',
  });
  return (
    <div>
      {videoLinks.jobs.map((job) => (
        <VideoLinkChip
          key={job.jobId}
          job={job}
          onCancel={() => void videoLinks.cancelJob(job.jobId)}
          onRetry={() => void videoLinks.retryJob(job.jobId)}
        />
      ))}
    </div>
  );
}

function renderChips() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ChipRow />
      <Toaster />
    </QueryClientProvider>,
  );
}

const CHIP = 'Video attachment: Shipment call';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

let backend: Backend;

beforeEach(async () => {
  await i18n.changeLanguage('en');
  backend = { jobs: [jobView()], cancel: [], retry: [], calls: [] };
  stubBackend(backend);
});

afterEach(() => {
  for (const shown of vi.mocked(toast).mock.results) {
    if (shown.type === 'return') shown.value.dismiss();
  }
  vi.mocked(toast).mockClear();
  vi.restoreAllMocks();
});

describe('Remove on a video chip', () => {
  it('puts a refused chip back and says why', async () => {
    const refusal = deferred<Response>();
    backend.cancel.push(() => refusal.promise);
    const { user, container } = renderChips();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    // Hidden at once, while the cancel is in flight.
    expect(screen.queryByRole('group', { name: CHIP })).not.toBeInTheDocument();

    refusal.resolve(NOT_A_MEMBER());

    expect(
      await screen.findByRole('group', { name: CHIP }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Couldn't remove this video")).toBeVisible();
    expect(
      screen.getByText(`Not a member of organization ${ORG}`),
    ).toBeVisible();
    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    // The chips read again: a refused cancel may have met a job that moved.
    await waitFor(() => {
      expect(backend.calls.filter((c) => c.startsWith('GET ')).length).toBe(2);
    });
    await checkAccessibility(container);
  });

  it('removes the chip on a second try once the refusal clears', async () => {
    backend.cancel.push(() => {
      throw new TypeError('Failed to fetch');
    });
    backend.cancel.push(() => json({ ok: true }));
    const { user } = renderChips();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(await screen.findByText("Couldn't remove this video")).toBeVisible();
    expect(
      screen.getByText(i18n.t('errors.connectionLost', { ns: 'common' })),
    ).toBeVisible();
    // The chip is back and its Remove still works.
    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(backend.calls.filter((c) => c.includes('/cancel'))).toHaveLength(
        2,
      );
    });
    // The refetch the success asks for finds the job skipped.
    await waitFor(() => {
      expect(
        backend.calls.filter((c) => c.startsWith('GET ')).length,
      ).toBeGreaterThanOrEqual(2);
    });
    expect(screen.queryByRole('group', { name: CHIP })).not.toBeInTheDocument();
    expect(toast).toHaveBeenCalledOnce();
  });

  it('says the video is still attached when the server faults', async () => {
    backend.cancel.push(() => json({ error: 'Internal Server Error' }, 500));
    const { user } = renderChips();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(await screen.findByText("Couldn't remove this video")).toBeVisible();
    expect(
      screen.getByText(
        i18n.t('videoLink.toast.removeFailedDescription', { ns: 'chat' }),
      ),
    ).toBeVisible();
    expect(
      await screen.findByRole('group', { name: CHIP }),
    ).toBeInTheDocument();
  });

  it('drops a chip whose job is already gone without a word', async () => {
    // The unbound-job sweep deleted the job: the door answers 404 and the
    // next read no longer lists it. Nothing is left to remove.
    backend.cancel.push(() => {
      backend.jobs = [];
      return json({ error: 'notFound', message: 'Video link not found' }, 404);
    });
    const { user } = renderChips();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(backend.calls.filter((c) => c.startsWith('GET ')).length).toBe(2);
    });
    expect(screen.queryByRole('group', { name: CHIP })).not.toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });

  it('removes the chip quietly when the cancel succeeds', async () => {
    backend.cancel.push(() => json({ ok: true }));
    const { user } = renderChips();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(backend.calls.filter((c) => c.startsWith('GET ')).length).toBe(2);
    });
    expect(screen.queryByRole('group', { name: CHIP })).not.toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('Try again on a failed video chip', () => {
  beforeEach(() => {
    backend.jobs = [
      jobView({ displayStatus: 'failed', errorReasonCode: 'rateLimited' }),
    ];
  });

  it('keeps the failed chip and names a video-link refusal in its own words', async () => {
    backend.retry.push(() =>
      json(
        {
          error: 'retryCooldown',
          message:
            'This video failed with a rate-limit / bot-detection signal. Please wait a few minutes before retrying.',
        },
        429,
      ),
    );
    const { user } = renderChips();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText("Couldn't retry this video")).toBeVisible();
    expect(
      screen.getByText(
        'This video was just rate-limited — wait a few minutes before retrying',
      ),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: CHIP })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  it('reads a refusal the video links do not name as Remove does', async () => {
    backend.retry.push(NOT_A_MEMBER);
    const { user } = renderChips();

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText("Couldn't retry this video")).toBeVisible();
    expect(
      screen.getByText(`Not a member of organization ${ORG}`),
    ).toBeVisible();
    expect(screen.getByRole('group', { name: CHIP })).toBeInTheDocument();
  });
});
