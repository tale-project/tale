import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WebsiteDoc } from '@/app/lib/backend/contract/docs';
import type { CrawlerPage } from '@/backend/core/websites/types';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ViewWebsiteDialog } from './website-view-dialog';

const canWrite = { current: true };
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
  crawledPageCount: 1,
  failedPageCount: 1,
};

describe('ViewWebsiteDialog', () => {
  beforeEach(() => {
    canWrite.current = true;
    pagesPayload.current = null;
  });

  it('titles the dialog with the site name, not a filler chrome title', async () => {
    render(<ViewWebsiteDialog isOpen onClose={vi.fn()} website={WEBSITE} />);

    const dialog = screen.getByRole('dialog', { name: 'Example docs' });
    expect(dialog).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Website details' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByText('Active')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: 'docs.example.com' }),
    ).toBeInTheDocument();
    const pagesTitle = within(dialog).getByText('Pages');
    expect(pagesTitle).toBeInTheDocument();
    expect(pagesTitle.parentElement).toHaveClass('justify-between');
    expect(within(dialog).getByText(/1 indexed/)).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '1 indexed · 1 page failed' }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).not.toHaveFocus();
    });
  });

  it('does not repeat table fields or empty placeholders', () => {
    render(<ViewWebsiteDialog isOpen onClose={vi.fn()} website={WEBSITE} />);

    expect(screen.queryByText('Scan interval')).not.toBeInTheDocument();
    expect(screen.queryByText('Last scanned')).not.toBeInTheDocument();
    expect(screen.queryByText('Created')).not.toBeInTheDocument();
    expect(screen.queryByText('Description')).not.toBeInTheDocument();
    expect(screen.queryByText('-')).not.toBeInTheDocument();
  });

  it('falls back to the domain when the site has no title', () => {
    render(
      <ViewWebsiteDialog
        isOpen
        onClose={vi.fn()}
        website={{ ...WEBSITE, title: undefined }}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'docs.example.com' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'docs.example.com' }),
    ).not.toBeInTheDocument();
  });

  it('offers Edit for a writer without opening the form until they ask', () => {
    render(<ViewWebsiteDialog isOpen onClose={vi.fn()} website={WEBSITE} />);

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      screen.queryByRole('dialog', { name: 'Edit website' }),
    ).not.toBeInTheDocument();
  });

  it('hides Edit for a reader', () => {
    canWrite.current = false;
    render(<ViewWebsiteDialog isOpen onClose={vi.fn()} website={WEBSITE} />);

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });

  it('swaps the same dialog into the edit form without a second overlay', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ViewWebsiteDialog isOpen onClose={onClose} website={WEBSITE} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const dialog = screen.getByRole('dialog', { name: 'Edit website' });
    expect(dialog).toHaveClass('md:max-w-[24rem]');
    expect(within(dialog).queryByText('Active')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'docs.example.com' }),
    ).not.toBeInTheDocument();
    const domain = screen.getByLabelText('Domain');
    expect(domain).toHaveValue('docs.example.com');
    expect(domain).toBeDisabled();
    expect(screen.getByLabelText('Scan interval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('returns to the view on Cancel without closing the overlay', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ViewWebsiteDialog isOpen onClose={onClose} website={WEBSITE} />,
    );

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Example docs' });
    expect(dialog).toHaveClass('md:max-w-[24rem]');
    expect(within(dialog).getByText('Active')).toBeInTheDocument();
    expect(screen.queryByLabelText('Scan interval')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
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
      <ViewWebsiteDialog
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

    const dialog = screen.getByRole('dialog', { name: 'Example' });
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
      screen.queryByLabelText('Search website content'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'https://example.com/' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('0 words')).not.toBeInTheDocument();
  });

  it('keeps the page list when a scan error follows indexed pages', () => {
    render(
      <ViewWebsiteDialog
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
    expect(screen.getByLabelText('Search website content')).toBeInTheDocument();
    expect(
      screen.queryByText("Nothing was indexed. The URL isn't the problem."),
    ).not.toBeInTheDocument();
  });

  it('names a failed page with a short reason, not the syscall dump', () => {
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

    render(<ViewWebsiteDialog isOpen onClose={vi.fn()} website={WEBSITE} />);

    expect(screen.getByText("Couldn't resolve the host.")).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'https://docs.example.com/' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 indexed/)).toBeInTheDocument();
    expect(screen.getByLabelText('Search website content')).toBeInTheDocument();
    expect(screen.queryByText(/getaddrinfo/)).not.toBeInTheDocument();
    expect(screen.queryByText('0 words')).not.toBeInTheDocument();
    expect(screen.queryByText('0 chunks')).not.toBeInTheDocument();
    expect(screen.queryByText(/Crawled/)).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ViewWebsiteDialog isOpen onClose={vi.fn()} website={WEBSITE} />,
      );
      await checkAccessibility(container);
    });
  });
});
