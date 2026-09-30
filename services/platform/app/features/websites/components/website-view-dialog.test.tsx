import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useBackendAction } from '@/app/hooks/use-backend-action';
import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import type { CrawlerPage } from '@/backend/core/websites/types';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { WebsiteViewDialog } from './website-view-dialog';

const canWrite = { current: true };
const scanNowMutate = vi.hoisted(() => vi.fn());
const pagesPayload = {
  current: null as null | {
    pages: CrawlerPage[];
    hasMore: boolean;
    offset: number;
  },
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
  const onSuccessByName = new Map<string, (data: unknown) => void>();
  const mutateByName = new Map<string, ReturnType<typeof vi.fn>>();
  return {
    useBackendAction: (
      name: string,
      options?: { onSuccess?: (data: unknown) => void },
    ) => {
      if (options?.onSuccess) onSuccessByName.set(name, options.onSuccess);
      let mutate = mutateByName.get(name);
      if (!mutate) {
        mutate = vi.fn(() => {
          if (name === 'websites/actions:fetchPages' && pagesPayload.current) {
            onSuccessByName.get(name)?.(pagesPayload.current);
          }
        });
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
    scanNowMutate.mockClear();
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

      expect(scanNowMutate).toHaveBeenCalledWith(
        { websiteId: 'w-1' },
        expect.anything(),
      );
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
    expect(screen.queryByText(/tale-sandbox-runtime/)).not.toBeInTheDocument();
    expect(screen.queryByText(/create_failed/)).not.toBeInTheDocument();
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
  // finish, over a bare "401 User not found." on hover.
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
            lastSyncError:
              'The embedding model could not embed the pages: 401 User not found.',
          },
        }}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Website details' });
    expect(
      within(dialog).getByRole('heading', {
        name: "The embedding model couldn't process the pages.",
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Nothing was indexed. An admin can check the embedding model under Settings → Data residency.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/User not found/)).not.toBeInTheDocument();
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
            lastSyncError: 'Host does not resolve: docs.example.com',
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
    expect(
      screen.getByText("The embedding model couldn't process the pages."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/User not found/)).not.toBeInTheDocument();
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

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <WebsiteViewDialog isOpen onClose={vi.fn()} website={WEBSITE} />,
      );
      await checkAccessibility(container);
    });
  });
});
