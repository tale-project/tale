import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBackendAction } from '@/app/hooks/use-backend-action';
import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import { WEBSITE_NOT_IN_CORPUS_MESSAGE } from '@/backend/core/websites/scan_scheduling';
import {
  type CrawlerPage,
  isSkippedPageKind,
} from '@/backend/core/websites/types';
import { checkAccessibility } from '@/tests/utils/a11y';
import { act, render, screen, waitFor, within } from '@/tests/utils/render';

import { WebsiteViewDialog } from './website-view-dialog';

const canWrite = { current: true };
const scanNowMutate = vi.hoisted(() => vi.fn());
/** Each action's hook-level success handler, to answer a request later. */
const answerAction = vi.hoisted(
  () => new Map<string, (data: unknown) => void>(),
);
const searchRequests = vi.hoisted(
  () =>
    [] as Array<{
      onSuccess?: (data: unknown) => void;
      onError?: () => void;
    }>,
);
/** Each action's hook-level error handler, to fail a request later. */
const failAction = vi.hoisted(() => new Map<string, () => void>());
const pagesPayload = {
  current: null as null | {
    pages: CrawlerPage[];
    hasMore: boolean;
    offset: number;
    state?: 'failed' | 'skipped' | null;
    counts?: { failed: number; skipped: number };
  },
};
/** A pages answer as the backend shapes it: the state the read asked for
 * echoed, the counts zero unless the payload says otherwise. */
const pagesAnswer = (
  payload: NonNullable<typeof pagesPayload.current>,
  args: unknown,
) => ({
  state:
    typeof args === 'object' &&
    args !== null &&
    'state' in args &&
    typeof args.state === 'string'
      ? args.state
      : null,
  counts: { failed: 0, skipped: 0 },
  ...payload,
});
interface PagesArgs {
  offset: number;
  limit: number;
  state?: 'failed' | 'skipped';
}
/** A pages read answered by what it asks, as the backend answers it: the
 * window of the state it names. Ahead of `pagesPayload` when set. */
const pagesRead = {
  current: null as
    | null
    | ((args: PagesArgs) => NonNullable<typeof pagesPayload.current>),
};

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => canWrite.current,
    cannot: () => !canWrite.current,
  }),
}));

vi.mock('@/app/hooks/use-backend-action', () => {
  const onSuccessByName = answerAction;
  const mutateByName = new Map<string, ReturnType<typeof vi.fn>>();
  return {
    useBackendAction: (
      name: string,
      options?: { onSuccess?: (data: unknown) => void; onError?: () => void },
    ) => {
      if (options?.onSuccess) onSuccessByName.set(name, options.onSuccess);
      if (options?.onError) failAction.set(name, options.onError);
      let mutate = mutateByName.get(name);
      if (!mutate) {
        mutate = vi.fn(
          (
            args: unknown,
            callbacks?: {
              onSuccess?: (data: unknown) => void;
              onError?: () => void;
            },
          ) => {
            if (name === 'websites/actions:searchContent') {
              searchRequests.push(callbacks ?? {});
              return;
            }
            if (name !== 'websites/actions:fetchPages') return;
            const payload =
              pagesRead.current?.(args as PagesArgs) ?? pagesPayload.current;
            if (payload)
              onSuccessByName.get(name)?.(pagesAnswer(payload, args));
          },
        );
        mutateByName.set(name, mutate);
      }
      return { mutate, isPending: false };
    },
  };
});

vi.mock('../hooks/mutations', () => ({
  useUpdateWebsite: () => ({ mutate: vi.fn(), isPending: false }),
  useResumeScanning: () => ({ mutate: vi.fn(), isPending: false }),
  useScanWebsiteNow: () => ({ mutate: scanNowMutate, isPending: false }),
}));

const WEBSITE: WebsiteDoc = {
  _id: 'w-1',
  _creationTime: Date.parse('2026-09-14T11:11:00'),
  organizationId: 'org-1',
  domain: 'docs.example.com',
  title: 'Example docs',
  description: '',
  status: 'active',
  scanInterval: '1d',
  lastScannedAt: Date.parse('2026-09-14T11:11:00'),
  crawledPageCount: 2,
  failedPageCount: 1,
};

describe('WebsiteViewDialog', () => {
  beforeEach(() => {
    canWrite.current = true;
    pagesPayload.current = null;
    pagesRead.current = null;
    scanNowMutate.mockClear();
    searchRequests.length = 0;
  });

  it('ignores a search response that is older than the latest request', async () => {
    const { user } = render(
      <WebsiteViewDialog isOpen onClose={vi.fn()} website={WEBSITE} />,
    );
    const search = screen.getByPlaceholderText('Search website content');

    await user.type(search, 'first');
    await user.keyboard('{Enter}');
    await user.clear(search);
    await user.type(search, 'second');
    await user.keyboard('{Enter}');

    expect(searchRequests).toHaveLength(2);
    const result = (title: string) => ({
      results: [
        {
          url: `https://docs.example.com/${title.toLowerCase()}`,
          title,
          chunk_index: 0,
          chunk_content: `${title} result`,
        },
      ],
    });

    await act(async () => {
      searchRequests[1]?.onSuccess?.(result('Second'));
    });
    expect(screen.getByText('Second result')).toBeInTheDocument();

    await act(async () => {
      searchRequests[0]?.onSuccess?.(result('First'));
    });
    expect(screen.getByText('Second result')).toBeInTheDocument();
    expect(screen.queryByText('First result')).not.toBeInTheDocument();
  });

  it('names the site in the shared record details', async () => {
    render(<WebsiteViewDialog isOpen onClose={vi.fn()} website={WEBSITE} />);

    const dialog = screen.getByRole('dialog', { name: 'Website details' });
    expect(
      within(dialog).getByRole('heading', { name: 'docs.example.com' }),
    ).toBeInTheDocument();
    const nameLabel = within(dialog).getByText('Name', {
      selector: 'dt span',
    });
    expect(nameLabel.closest('div')?.querySelector('dd')).toHaveTextContent(
      'Example docs',
    );
    const idLabel = within(dialog).getByText('Website ID', {
      selector: 'dt span',
    });
    expect(idLabel.closest('div')?.querySelector('dd')).toHaveTextContent(
      WEBSITE._id,
    );
    expect(within(dialog).getByText('Active')).toBeInTheDocument();
    expect(within(dialog).getByText('Website pages')).toBeInTheDocument();
    expect(within(dialog).getByText(/1 indexed/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).not.toHaveFocus();
    });
  });

  it('falls back to the domain when the site has no title', () => {
    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, title: undefined }}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'docs.example.com' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'docs.example.com' }),
    ).not.toBeInTheDocument();
  });

  it('offers Edit for a writer without opening the form until they ask', () => {
    render(<WebsiteViewDialog isOpen onClose={vi.fn()} website={WEBSITE} />);

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Edit website' }),
    ).not.toBeInTheDocument();
  });

  it('hides Edit for a reader', () => {
    canWrite.current = false;
    render(<WebsiteViewDialog isOpen onClose={vi.fn()} website={WEBSITE} />);

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });

  describe('scan now', () => {
    it('queues a scan for a writer on a site that is not scanning', async () => {
      const { user } = render(
        <WebsiteViewDialog
          isOpen
          onClose={vi.fn()}
          website={{ ...WEBSITE, status: 'error' }}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Scan now' }));

      expect(scanNowMutate).toHaveBeenCalledWith({ websiteId: 'w-1' });
    });

    it('is not offered while the site is scanning, nor to a reader', () => {
      const { unmount } = render(
        <WebsiteViewDialog
          isOpen
          onClose={vi.fn()}
          website={{ ...WEBSITE, status: 'scanning' }}
        />,
      );
      expect(
        screen.queryByRole('button', { name: 'Scan now' }),
      ).not.toBeInTheDocument();
      unmount();

      canWrite.current = false;
      render(<WebsiteViewDialog isOpen onClose={vi.fn()} website={WEBSITE} />);
      expect(
        screen.queryByRole('button', { name: 'Scan now' }),
      ).not.toBeInTheDocument();
    });
  });

  it('swaps to the edit dialog on Edit and back to the details on cancel', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <WebsiteViewDialog isOpen onClose={onClose} website={WEBSITE} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const editDialog = await screen.findByRole('dialog', {
      name: 'Edit website',
    });
    expect(onClose).not.toHaveBeenCalled();
    const domain = within(editDialog).getByLabelText('Domain');
    expect(domain).toHaveValue('docs.example.com');
    expect(domain).toHaveAttribute('readonly');
    expect(
      within(editDialog).getByLabelText('Scan interval'),
    ).toBeInTheDocument();

    await user.click(
      within(editDialog).getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Website details' }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('replaces a hollow scan failure with a teaching empty, not a fake page list', () => {
    pagesPayload.current = {
      offset: 0,
      hasMore: false,
      pages: [
        {
          url: 'https://example.com/',
          title: null,
          word_count: 0,
          status: 'discovered',
          content_hash: null,
          last_crawled_at: null,
          discovered_at: '2026-09-14T11:11:00.000Z',
          chunks_count: 0,
          indexed: false,
          fail_count: 0,
          last_error: null,
          last_error_kind: null,
          last_error_at: null,
        },
      ],
    };

    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{
          ...WEBSITE,
          domain: 'example.com',
          title: 'Example',
          status: 'error',
          crawledPageCount: 0,
          failedPageCount: 0,
          metadata: {
            lastSyncError:
              'sandbox session create failed (502): {"error":"create_failed","message":"docker run (session) failed: Unable to find image \'tale-sandbox-runtime:latest\' locally"}',
          },
        }}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Website details' });
    expect(within(dialog).getByText('Error')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', {
        name: "Scanning didn't run.",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Nothing was indexed. The URL isn't the problem.",
      ),
    ).toBeInTheDocument();
    // A red banner, not a muted box: the dump is folded under Technical
    // details, where a reader finds it, instead of sitting on `title`.
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveAttribute('data-variant', 'destructive');
    expect(alert).not.toHaveAttribute('title');
    const details = within(alert)
      .getByText('Technical details')
      .closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(within(alert).getByText(/tale-sandbox-runtime/)).toBeInTheDocument();
    expect(screen.queryByText(/0 indexed/)).not.toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Search website content'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'https://example.com/' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('0 words')).not.toBeInTheDocument();
  });

  // A rejected embedding key: the site said only that the last scan did not
  // finish, over a bare "401 User not found." on hover. The banner now leads
  // with the model, says whom to ask, and shows the provider's sentence.
  it('names the embedding model when it could not embed the pages', () => {
    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{
          ...WEBSITE,
          status: 'error',
          crawledPageCount: 0,
          failedPageCount: 0,
          metadata: {
            // A reason from before the class was recorded.
            lastSyncError:
              'The embedding model could not embed the pages: 401 User not found.',
          },
        }}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Website details' });
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveAttribute('data-variant', 'destructive');
    expect(
      within(alert).getByRole('heading', {
        name: "The embedding model couldn't process the pages.",
      }),
    ).toBeInTheDocument();
    expect(within(alert).getByText('Nothing was indexed.')).toBeInTheDocument();
    expect(
      within(alert).getByText(
        'An admin can check the embedding model under Settings → Data residency.',
      ),
    ).toBeInTheDocument();
    expect(within(alert).getByText('401 User not found.')).toBeVisible();
    expect(within(alert).queryByText('Technical details')).toBeNull();
    expect(
      within(alert).queryByText(/could not embed the pages/),
    ).not.toBeInTheDocument();
  });

  // The class the crawl action records picks the hint: a rejected
  // credential sends an admin to AI providers, not to the model's setting.
  it("tells the embedding failure's class and whom to ask", () => {
    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{
          ...WEBSITE,
          status: 'error',
          crawledPageCount: 0,
          failedPageCount: 0,
          metadata: {
            lastSyncError:
              'The embedding model could not embed the pages [credential]: 401 User not found.',
          },
        }}
      />,
    );

    const alert = within(
      screen.getByRole('dialog', { name: 'Website details' }),
    ).getByRole('alert');
    expect(
      within(alert).getByText(
        "The provider rejected the embedding model's credential. An admin can repair it under Settings → AI providers.",
      ),
    ).toBeInTheDocument();
    expect(within(alert).getByText('401 User not found.')).toBeVisible();
    expect(within(alert).queryByText(/\[credential\]/)).toBeNull();
  });

  // A whole site missing from the crawler is registered again by its next
  // scan; it was told to delete itself and be added again, which only a URL
  // list still has to do.
  it('tells a site missing from the crawler to wait for its scan, a URL list to be added again', () => {
    const missing: WebsiteDoc = {
      ...WEBSITE,
      status: 'error',
      crawledPageCount: 0,
      failedPageCount: 0,
      metadata: { lastSyncError: WEBSITE_NOT_IN_CORPUS_MESSAGE },
    };
    const { unmount } = render(
      <WebsiteViewDialog isOpen onClose={vi.fn()} website={missing} />,
    );

    const siteDialog = screen.getByRole('dialog', { name: 'Website details' });
    expect(
      within(siteDialog).getByRole('heading', {
        name: "This site isn't in the crawler. The next scan adds it again.",
      }),
    ).toBeInTheDocument();
    expect(
      within(siteDialog).getByText(
        'Nothing was indexed. The next scan adds the site again.',
      ),
    ).toBeInTheDocument();
    expect(within(siteDialog).queryByText(/add it again/)).toBeNull();
    unmount();

    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...missing, kind: 'list' }}
      />,
    );

    const listDialog = screen.getByRole('dialog', { name: 'Website details' });
    expect(
      within(listDialog).getByRole('heading', {
        name: "This URL list isn't in the crawler. Delete it and add it again.",
      }),
    ).toBeInTheDocument();
    expect(
      within(listDialog).getByText(
        'Nothing was indexed. Delete the URL list and add it again.',
      ),
    ).toBeInTheDocument();
  });

  it('keeps the page list when a scan error follows indexed pages', () => {
    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{
          ...WEBSITE,
          status: 'error',
          metadata: {
            lastSyncError:
              'sandbox session create failed (502): {"error":"create_failed"}',
          },
        }}
      />,
    );

    expect(screen.getByText("Scanning didn't run.")).toBeInTheDocument();
    expect(screen.getByText(/1 indexed/)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Search website content'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing was indexed. The URL isn't the problem."),
    ).not.toBeInTheDocument();
  });

  it('names a DNS failure without counting its attempted page as indexed', async () => {
    pagesPayload.current = {
      offset: 0,
      hasMore: false,
      // The read counts the failed page it lists.
      counts: { failed: 1, skipped: 0 },
      pages: [
        {
          url: 'https://docs.example.com/',
          title: null,
          word_count: 0,
          status: 'discovered',
          content_hash: null,
          last_crawled_at: '2026-09-14T11:11:00.000Z',
          discovered_at: '2026-09-14T11:11:00.000Z',
          chunks_count: 0,
          indexed: false,
          fail_count: 1,
          last_error:
            'Host does not resolve: docs.example.com (getaddrinfo ENOTFOUND docs.example.com)',
          last_error_kind: 'dns_failed',
          last_error_at: '2026-09-14T11:11:00.000Z',
        },
      ],
    };

    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{
          ...WEBSITE,
          crawledPageCount: 1,
          failedPageCount: 1,
          metadata: {
            // What the crawl action stores for a host that does not
            // resolve: its tally of the pages it attempted.
            lastSyncError:
              'No page could be stored: 1 of 1 attempted pages failed (dns_failed)',
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Couldn't resolve the host."),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://docs.example.com/' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 indexed/)).toBeInTheDocument();
    expect(screen.getByText(/1 page failed/)).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText('Search website content'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/getaddrinfo/)).not.toBeInTheDocument();
    expect(screen.queryByText('0 words')).not.toBeInTheDocument();
    expect(screen.queryByText('0 chunks')).not.toBeInTheDocument();
  });

  // A site whose scan the embedding model stopped also had pages that
  // answered 404. Their rows said so, the scan's own reason was left out,
  // and the Error read as the pages' doing.
  it('names what stopped the scan beside pages that failed for their own reasons', async () => {
    pagesPayload.current = {
      offset: 0,
      hasMore: false,
      pages: [
        {
          url: 'https://docs.example.com/gone',
          title: null,
          word_count: 0,
          status: 'discovered',
          content_hash: null,
          last_crawled_at: '2026-09-14T11:11:00.000Z',
          discovered_at: '2026-09-14T11:11:00.000Z',
          chunks_count: 0,
          indexed: false,
          fail_count: 1,
          last_error: 'HTTP 404',
          last_error_kind: 'http_error',
          last_error_at: '2026-09-14T11:11:00.000Z',
        },
      ],
    };

    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{
          ...WEBSITE,
          status: 'error',
          crawledPageCount: 12,
          failedPageCount: 1,
          metadata: {
            lastSyncError:
              'The embedding model could not embed the pages: 401 User not found.',
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByText('The page answered with an error.'),
      ).toBeInTheDocument();
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('data-variant', 'destructive');
    expect(
      within(alert).getByRole('heading', {
        name: "The embedding model couldn't process the pages.",
      }),
    ).toBeInTheDocument();
    expect(within(alert).getByText('401 User not found.')).toBeVisible();
    expect(within(alert).queryByText('Nothing was indexed.')).toBeNull();
    expect(alert).not.toHaveAttribute('title');
  });

  // "5 pages failed" used to be a number beside a list that hid them twenty
  // rows at a time. The count opens the failed pages, the segments switch
  // between every page, the failed and the skipped ones, and each switch is
  // a fresh read from the top under that state.
  it('narrows the list to the failed or the skipped pages', async () => {
    pagesPayload.current = {
      offset: 0,
      hasMore: false,
      counts: { failed: 2, skipped: 1 },
      pages: [
        {
          url: 'https://docs.example.com/fine',
          title: 'Fine',
          word_count: 120,
          status: 'active',
          content_hash: 'abc',
          last_crawled_at: '2026-09-14T11:11:00.000Z',
          discovered_at: '2026-09-14T11:11:00.000Z',
          chunks_count: 3,
          indexed: true,
          fail_count: 0,
          last_error: null,
          last_error_kind: null,
          last_error_at: null,
        },
      ],
    };
    const { mutate: fetchPages } = useBackendAction(
      'websites/actions:fetchPages',
    );
    vi.mocked(fetchPages).mockClear();
    const { user } = render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{
          ...WEBSITE,
          status: 'active',
          crawledPageCount: 12,
          failedPageCount: 2,
        }}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Website details' });
    expect(fetchPages).toHaveBeenLastCalledWith({
      websiteId: 'w-1',
      offset: 0,
      limit: 20,
    });
    const filter = within(dialog).getByRole('radiogroup', {
      name: 'Which pages to show',
    });
    expect(
      within(filter).getByRole('radio', { name: 'Failed (2)' }),
    ).toBeInTheDocument();
    expect(
      within(filter).getByRole('radio', { name: 'Skipped (1)' }),
    ).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: '2 pages failed' }),
    );
    expect(fetchPages).toHaveBeenLastCalledWith({
      websiteId: 'w-1',
      offset: 0,
      limit: 20,
      state: 'failed',
    });
    expect(
      within(filter).getByRole('radio', { name: 'Failed (2)' }),
    ).toHaveAttribute('aria-checked', 'true');

    await user.click(
      within(filter).getByRole('radio', { name: 'Skipped (1)' }),
    );
    expect(fetchPages).toHaveBeenLastCalledWith({
      websiteId: 'w-1',
      offset: 0,
      limit: 20,
      state: 'skipped',
    });

    await user.click(within(filter).getByRole('radio', { name: 'All' }));
    expect(fetchPages).toHaveBeenLastCalledWith({
      websiteId: 'w-1',
      offset: 0,
      limit: 20,
    });
    expect(fetchPages).toHaveBeenCalledTimes(4);

    expect(within(dialog).getByText('Fine')).toBeVisible();
    pagesPayload.current = {
      ...pagesPayload.current,
      pages: pagesPayload.current.pages.map((page) => ({
        ...page,
        url: 'https://docs.example.com/broken',
        title: 'Broken',
        indexed: false,
        fail_count: 1,
        last_error: 'Page not found',
        last_error_kind: 'http_error',
      })),
    };
    await user.keyboard('{ArrowRight}');
    const failed = within(filter).getByRole('radio', { name: 'Failed (2)' });
    expect(failed).toHaveFocus();
    expect(failed).toHaveAttribute('aria-checked', 'true');
    expect(fetchPages).toHaveBeenLastCalledWith({
      websiteId: 'w-1',
      offset: 0,
      limit: 20,
      state: 'failed',
    });
    expect(within(dialog).queryByText('Fine')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Broken')).toBeVisible();
    expect(within(dialog).getByText('Failed')).toBeVisible();
    expect(fetchPages).toHaveBeenCalledTimes(5);
  });

  it('says so when no page is in the chosen state', async () => {
    pagesPayload.current = {
      offset: 0,
      hasMore: false,
      counts: { failed: 1, skipped: 0 },
      pages: [],
    };
    const { user } = render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, status: 'active', failedPageCount: 1 }}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Website details' });
    await user.click(
      within(dialog).getByRole('radio', { name: 'Skipped (0)' }),
    );
    expect(within(dialog).getByText('No page was skipped')).toBeInTheDocument();
  });

  // The scan-failure Alert was decided from the rows the open window held:
  // one DNS-failed site showed it over twenty indexed rows, hid it once
  // "Load more" reached a failed page, hid it under Failed and showed it
  // again under an empty Skipped (#4068). It speaks for the site's scan, so
  // it stays put whichever state and window the list shows.
  describe("the scan failure's Alert across the page list", () => {
    const crawled = '2026-10-02T08:15:00.000Z';
    const indexedPage = (index: number): CrawlerPage => ({
      url: `https://docs.example.com/indexed-${index}`,
      title: null,
      word_count: 10,
      status: 'active',
      content_hash: 'h',
      last_crawled_at: crawled,
      discovered_at: crawled,
      chunks_count: 1,
      indexed: true,
      fail_count: 0,
      last_error: null,
      last_error_kind: null,
      last_error_at: null,
    });
    const unstoredPage = (
      path: string,
      lastError: string,
      lastErrorKind: string,
    ): CrawlerPage => ({
      url: `https://docs.example.com/${path}`,
      title: null,
      word_count: 0,
      status: 'discovered',
      content_hash: null,
      last_crawled_at: crawled,
      discovered_at: crawled,
      chunks_count: 0,
      indexed: false,
      fail_count: 1,
      last_error: lastError,
      last_error_kind: lastErrorKind,
      last_error_at: crawled,
    });
    const homePage = unstoredPage(
      '',
      'Host does not resolve: docs.example.com',
      'dns_failed',
    );
    const times = (count: number, page: (index: number) => CrawlerPage) =>
      Array.from({ length: count }, (_, index) => page(index));
    // The seeded site of #4068: the indexed pages were crawled last, so
    // they lead the list, and the failed and skipped ones follow.
    const seeded = [
      ...times(25, indexedPage),
      homePage,
      ...times(25, (index) =>
        unstoredPage(`gone-${index}`, 'HTTP 404', 'http_error'),
      ),
      ...times(3, (index) =>
        unstoredPage(
          `private-${index}`,
          'The page asks not to be indexed',
          'robots_noindex',
        ),
      ),
    ];
    const dnsFailedSite: WebsiteDoc = {
      ...WEBSITE,
      status: 'error',
      crawledPageCount: 51,
      failedPageCount: 26,
      metadata: {
        lastSyncError:
          'No page could be stored: 1 of 1 attempted pages failed (dns_failed)',
      },
    };

    /** Answers every read with its state's window of `inventory` and the
     * counts of the whole inventory, as the backend does. */
    const listPages = (inventory: CrawlerPage[]) => {
      const stateOf = (page: CrawlerPage) =>
        page.last_error === null
          ? null
          : page.last_error_kind !== null &&
              isSkippedPageKind(page.last_error_kind)
            ? 'skipped'
            : 'failed';
      const counts = {
        failed: inventory.filter((page) => stateOf(page) === 'failed').length,
        skipped: inventory.filter((page) => stateOf(page) === 'skipped').length,
      };
      pagesRead.current = ({ offset, limit, state }) => {
        const rows = inventory.filter(
          (page) => state === undefined || stateOf(page) === state,
        );
        return {
          offset,
          hasMore: offset + limit < rows.length,
          counts,
          pages: rows.slice(offset, offset + limit),
        };
      };
    };

    /** Opens the site, walks every state and every window a reader can
     * reach, and notes in each whether the Alert stands above the list. */
    const alertPerView = async (website: WebsiteDoc) => {
      const { user } = render(
        <WebsiteViewDialog isOpen onClose={vi.fn()} website={website} />,
      );
      const dialog = screen.getByRole('dialog', { name: 'Website details' });
      const seen: Record<string, boolean> = {};
      const readAll = async (view: string) => {
        seen[view] = within(dialog).queryByRole('alert') !== null;
        for (let more = 1; ; more += 1) {
          const loadMore = within(dialog).queryByRole('button', {
            name: 'Load more',
          });
          if (loadMore === null) return;
          await user.click(loadMore);
          seen[`${view} + Load more ${more}`] =
            within(dialog).queryByRole('alert') !== null;
        }
      };
      await readAll('All');
      const filter = within(dialog).queryByRole('radiogroup', {
        name: 'Which pages to show',
      });
      for (const radio of filter === null
        ? []
        : within(filter).getAllByRole('radio').slice(1)) {
        await user.click(radio);
        await readAll(radio.textContent ?? '');
      }
      return seen;
    };

    it('leaves it out in every view when the failed pages say why', async () => {
      listPages(seeded);
      expect(await alertPerView(dnsFailedSite)).toEqual({
        All: false,
        'All + Load more 1': false,
        'All + Load more 2': false,
        'Failed (26)': false,
        'Failed (26) + Load more 1': false,
        'Skipped (3)': false,
      });
    });

    it('leaves it out under an empty Skipped when the one failed page says why', async () => {
      listPages([homePage]);
      expect(
        await alertPerView({
          ...dnsFailedSite,
          crawledPageCount: 1,
          failedPageCount: 1,
        }),
      ).toEqual({ All: false, 'Failed (1)': false, 'Skipped (0)': false });
    });

    it('keeps a site-level reason in every view', async () => {
      listPages(seeded);
      expect(
        await alertPerView({
          ...dnsFailedSite,
          metadata: {
            lastSyncError:
              'The embedding model could not embed the pages: 401 User not found.',
          },
        }),
      ).toEqual({
        All: true,
        'All + Load more 1': true,
        'All + Load more 2': true,
        'Failed (26)': true,
        'Failed (26) + Load more 1': true,
        'Skipped (3)': true,
      });
    });

    // The row counts a scan's pages after the scan; until it has, an empty
    // segment read as a hollow scan and took the list and its segments.
    it('keeps the list in an empty segment the row has not counted yet', async () => {
      listPages([homePage]);
      const { user } = render(
        <WebsiteViewDialog
          isOpen
          onClose={vi.fn()}
          website={{
            ...dnsFailedSite,
            crawledPageCount: 0,
            failedPageCount: 0,
          }}
        />,
      );
      const dialog = screen.getByRole('dialog', { name: 'Website details' });

      await user.click(
        within(dialog).getByRole('radio', { name: 'Skipped (0)' }),
      );

      expect(
        within(dialog).getByText('No page was skipped'),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole('radio', { name: 'Failed (1)' }),
      ).toBeInTheDocument();
      expect(within(dialog).queryByRole('alert')).toBeNull();
    });

    // A reason no page explains — a lost knowledge database, a sitemap that
    // timed out — was hidden in every view once any page had failed or been
    // skipped, and the Alert is the only place a scan's reason shows.
    it.each([
      'Connection terminated unexpectedly',
      'Reading the sitemap timed out',
    ])('keeps "%s" in every view beside skipped pages', async (reason) => {
      listPages([
        ...times(25, indexedPage),
        ...times(3, (index) =>
          unstoredPage(
            `private-${index}`,
            'The page asks not to be indexed',
            'robots_noindex',
          ),
        ),
      ]);
      expect(
        await alertPerView({
          ...dnsFailedSite,
          crawledPageCount: 25,
          failedPageCount: 0,
          metadata: { lastSyncError: reason },
        }),
      ).toEqual({
        All: true,
        'All + Load more 1': true,
        'Failed (0)': true,
        'Skipped (3)': true,
      });
    });

    it('leaves it out over a site whose every page was skipped', async () => {
      listPages(
        times(3, (index) =>
          unstoredPage(
            `private-${index}`,
            'The page asks not to be indexed',
            'robots_noindex',
          ),
        ),
      );
      expect(
        await alertPerView({
          ...dnsFailedSite,
          crawledPageCount: 3,
          failedPageCount: 0,
          metadata: {
            lastSyncError:
              'No page could be stored: 0 of 3 attempted pages failed and 3 were skipped (robots_noindex)',
          },
        }),
      ).toEqual({ All: false, 'Failed (0)': false, 'Skipped (3)': false });
    });

    // While the first read is out, the row's own count stands in, so the
    // Alert does not flash over a site whose pages say why; a read that
    // failed leaves no page to say anything, so the Alert says it.
    it('stands on the row while the first read is out, and shows once it failed', () => {
      render(
        <WebsiteViewDialog
          isOpen
          onClose={vi.fn()}
          website={{
            ...dnsFailedSite,
            crawledPageCount: 2,
            failedPageCount: 2,
            metadata: {
              lastSyncError:
                'No page could be stored: 2 of 2 attempted pages failed (http_error)',
            },
          }}
        />,
      );
      const dialog = screen.getByRole('dialog', { name: 'Website details' });
      expect(within(dialog).queryByRole('alert')).toBeNull();

      act(() => failAction.get('websites/actions:fetchPages')?.());

      expect(within(dialog).getByRole('alert')).toBeInTheDocument();
    });

    it('keeps it however far the list is read when no page says why', async () => {
      listPages(times(25, indexedPage));
      expect(
        await alertPerView({
          ...dnsFailedSite,
          crawledPageCount: 25,
          failedPageCount: 0,
          metadata: { lastSyncError: 'Reading the sitemap timed out' },
        }),
      ).toEqual({ All: true, 'All + Load more 1': true });
    });
  });

  // A failure charged to the render lane, not the page, leaves the reason
  // without a strike; the row used to read as a page nobody had fetched.
  it('shows the reason of a failure that cost the page no strike', () => {
    pagesPayload.current = {
      offset: 0,
      hasMore: false,
      pages: [
        {
          url: 'https://docs.example.com/halted',
          title: null,
          word_count: 0,
          status: 'discovered',
          content_hash: null,
          last_crawled_at: '2026-09-14T11:11:00.000Z',
          discovered_at: '2026-09-14T11:11:00.000Z',
          chunks_count: 0,
          indexed: false,
          fail_count: 0,
          last_error: 'browser closed',
          last_error_kind: 'render_failed',
          last_error_at: '2026-09-14T11:11:00.000Z',
        },
      ],
    };
    render(
      <WebsiteViewDialog isOpen onClose={vi.fn()} website={{ ...WEBSITE }} />,
    );
    expect(
      screen.getByText("The browser couldn't render the page."),
    ).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  // The row follows a scan through realtime hints; the pages were read once
  // on open, so an open dialog showed the first batch for the whole scan.
  it('reads the shown pages again when a scan moves the row', () => {
    const { mutate: fetchPages } = useBackendAction(
      'websites/actions:fetchPages',
    );
    vi.mocked(fetchPages).mockClear();
    const { rerender } = render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, status: 'scanning' }}
      />,
    );
    expect(fetchPages).toHaveBeenCalledTimes(1);

    // The same row again: nothing moved, nothing is read.
    rerender(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, status: 'scanning' }}
      />,
    );
    expect(fetchPages).toHaveBeenCalledTimes(1);

    rerender(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, status: 'scanning', crawledPageCount: 12 }}
      />,
    );
    expect(fetchPages).toHaveBeenCalledTimes(2);
    expect(fetchPages).toHaveBeenLastCalledWith({
      websiteId: 'w-1',
      offset: 0,
      limit: 20,
    });
  });

  // A "Load more" answer that arrived after a refresh answer was appended
  // again: the refresh had read the same rows, and they showed twice.
  it('drops a page read that a refresh has overtaken', async () => {
    const pageAt = (index: number): CrawlerPage => ({
      url: `https://docs.example.com/${index}`,
      title: null,
      word_count: 10,
      status: 'active',
      content_hash: 'h',
      last_crawled_at: '2026-09-14T11:11:00.000Z',
      discovered_at: '2026-09-14T11:11:00.000Z',
      chunks_count: 1,
      indexed: true,
      fail_count: 0,
      last_error: null,
      last_error_kind: null,
      last_error_at: null,
    });
    const range = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, index) => pageAt(from + index));
    pagesPayload.current = { offset: 0, hasMore: true, pages: range(0, 20) };
    const { rerender, user } = render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, status: 'scanning' }}
      />,
    );
    await screen.findByRole('link', { name: 'https://docs.example.com/19' });

    // Both reads leave; neither has answered yet.
    pagesPayload.current = null;
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    rerender(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, status: 'scanning', crawledPageCount: 40 }}
      />,
    );
    const answer = answerAction.get('websites/actions:fetchPages');
    // The refresh answers first, the page read after it.
    answer?.(
      pagesAnswer({ offset: 0, hasMore: false, pages: range(0, 40) }, {}),
    );
    answer?.(
      pagesAnswer({ offset: 20, hasMore: true, pages: range(20, 40) }, {}),
    );

    await waitFor(() => {
      expect(
        screen.getAllByRole('link', { name: 'https://docs.example.com/39' }),
      ).toHaveLength(1);
    });
    expect(
      screen.getAllByRole('link', { name: 'https://docs.example.com/25' }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });

  // A page the crawler skipped on purpose — a JSON endpoint, a noindex page,
  // an off-site redirect — is its choice, not a failure: it reads Skipped
  // with the reason alone, and no attempts are counted up (2026-09-30).
  it('reads a page the crawler skipped on purpose as skipped, with the reason alone', async () => {
    pagesPayload.current = {
      offset: 0,
      hasMore: false,
      pages: [
        {
          url: 'https://docs.example.com/data.json',
          title: null,
          word_count: 0,
          status: 'discovered',
          content_hash: null,
          last_crawled_at: '2026-09-30T11:11:00.000Z',
          discovered_at: '2026-09-30T11:11:00.000Z',
          chunks_count: 0,
          indexed: false,
          fail_count: 3,
          last_error:
            'The page answered "application/json", which the crawler cannot turn into text',
          last_error_kind: 'unsupported_content',
          last_error_at: '2026-09-30T11:11:00.000Z',
        },
      ],
    };

    render(
      <WebsiteViewDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, crawledPageCount: 1, failedPageCount: 0 }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Skipped')).toBeInTheDocument();
    });
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    expect(
      screen.getByText("This page isn't text the crawler can index."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed attempts/)).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <WebsiteViewDialog isOpen onClose={vi.fn()} website={WEBSITE} />,
      );
      await checkAccessibility(container);
    });
  });
});
