// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toast } from '@/app/hooks/use-toast';
import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

// Controllable mutate so a test can drive its onError callback. The dialog uses
// the callback form `mutate(args, { onSuccess, onError })` for site mode and
// awaits `mutateAsync(args)` once per domain group in URL-list mode.
const createWebsiteMock = vi.fn();
const createWebsiteAsyncMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useCreateWebsite: () => ({
    mutate: createWebsiteMock,
    mutateAsync: createWebsiteAsyncMock,
    isPending: false,
  }),
}));

import { AddWebsiteDialog } from './website-add-dialog';

async function fillAndSubmit(user: ReturnType<typeof render>['user']) {
  const domain = document.querySelector(
    'input[name="domain"]',
  ) as HTMLInputElement;
  await user.type(domain, 'example.com');

  const submit = document.querySelector(
    'button[type="submit"]',
  ) as HTMLButtonElement;
  await waitFor(() => expect(submit).toBeEnabled());
  await user.click(submit);
}

describe('AddWebsiteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await checkAccessibility(container);
    });
  });

  // Migrated from knowledge.spec.ts e2e
  // ("opens the add-website dialog and renders its fields").
  // Pure dialog-open + field rendering — no real persistence, navigation,
  // streaming, RBAC, or connector call. The e2e deliberately stopped at
  // "fields render" because website CRUD hits the crawler service, which the
  // hermetic stack does not run; the rendered-UI assertions move cleanly here.
  describe('renders the add-website dialog and its fields', () => {
    it('shows the dialog titled "Add website" with the domain and scan-interval fields', () => {
      render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );

      // Dialog opens with the localized title (e2e: getByRole('dialog',
      // { name: t('websites.addWebsite') })).
      const dialog = screen.getByRole('dialog', { name: 'Add website' });
      expect(dialog).toBeInTheDocument();

      // Domain field renders with its label (e2e: getByLabel(t('websites.domain'))).
      expect(screen.getByLabelText('Domain')).toBeInTheDocument();

      // Scan-interval field renders with its label (e2e:
      // getByText(t('websites.scanInterval'))).
      expect(screen.getByText('Scan interval')).toBeInTheDocument();
    });
  });

  // Regression for #2056: the duplicate-domain toast relied on
  // `error.message.includes('already exists')`, which is dead in prod because
  // Convex redacts raw Error messages to "Server Error". The backend now throws
  // AppError({ code: 'WEBSITE_DUPLICATE_DOMAIN' }) and the dialog reads it.
  describe('duplicate domain (#2056)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('surfaces the duplicate toast when the server throws the duplicate code', async () => {
      createWebsiteMock.mockImplementation(
        (_args: unknown, opts: { onError: (e: unknown) => void }) => {
          opts.onError(
            new AppError({
              code: 'WEBSITE_DUPLICATE_DOMAIN',
              domain: 'example.com',
            }),
          );
        },
      );

      const { user } = render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await fillAndSubmit(user);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'This website has already been added',
            variant: 'destructive',
          }),
        ),
      );
    });

    it('falls back to the generic error toast for a non-duplicate failure', async () => {
      createWebsiteMock.mockImplementation(
        (_args: unknown, opts: { onError: (e: unknown) => void }) => {
          opts.onError(new AppError({ code: 'SOMETHING_ELSE' }));
        },
      );

      const { user } = render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await fillAndSubmit(user);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Failed to add website',
            variant: 'destructive',
          }),
        ),
      );
    });
  });

  describe('URL list mode', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('groups pasted URLs into one create call per website, folding www', async () => {
      createWebsiteAsyncMock.mockResolvedValue('site-id');
      const onClose = vi.fn();
      const { user } = render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={onClose}
          organizationId="test-org-id"
        />,
      );

      await user.click(screen.getByRole('radio', { name: 'URL list' }));
      const textarea = screen.getByLabelText('URLs');
      await user.type(
        textarea,
        'https://www.fedlex.admin.ch/eli/cc/2009/615/de{enter}' +
          'https://fedlex.admin.ch/eli/cc/2009/828/de{enter}' +
          'https://www.bazg.admin.ch/dam/52_15.pdf',
      );

      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      await waitFor(() =>
        expect(createWebsiteAsyncMock).toHaveBeenCalledTimes(2),
      );
      expect(createWebsiteAsyncMock).toHaveBeenCalledWith({
        organizationId: 'test-org-id',
        domain: 'fedlex.admin.ch',
        scanInterval: '6h',
        urls: [
          'https://www.fedlex.admin.ch/eli/cc/2009/615/de',
          'https://fedlex.admin.ch/eli/cc/2009/828/de',
        ],
      });
      expect(createWebsiteAsyncMock).toHaveBeenCalledWith({
        organizationId: 'test-org-id',
        domain: 'bazg.admin.ch',
        scanInterval: '6h',
        urls: ['https://www.bazg.admin.ch/dam/52_15.pdf'],
      });
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: 'success' }),
        ),
      );
      expect(onClose).toHaveBeenCalled();
    });

    it('rejects an unparseable line with a field error and no calls', async () => {
      const { user } = render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );

      await user.click(screen.getByRole('radio', { name: 'URL list' }));
      await user.type(screen.getByLabelText('URLs'), 'not a url at all');
      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      await user.click(submit);

      await waitFor(() =>
        expect(
          screen.getByText('This line is not a valid URL: not a url at all'),
        ).toBeInTheDocument(),
      );
      expect(createWebsiteAsyncMock).not.toHaveBeenCalled();
    });

    it('passes axe audit in list mode', async () => {
      const { container, user } = render(
        <AddWebsiteDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await user.click(screen.getByRole('radio', { name: 'URL list' }));
      await checkAccessibility(container);
    });
  });
});
