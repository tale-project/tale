// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  lapsedSessionRefusal,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { render, screen, waitFor } from '@/tests/utils/render';

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

// Controllable write: the dialog reports from each call's own promise —
// `mutateAsync(args).then(onSuccess, onError)` in site mode, one awaited
// `mutateAsync(args)` per domain group in URL-list mode.
const createWebsiteAsyncMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useCreateWebsite: () => ({
    mutateAsync: createWebsiteAsyncMock,
    isPending: false,
  }),
}));

import { WebsiteCreateDialog } from './website-create-dialog';

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

describe('WebsiteCreateDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <WebsiteCreateDialog
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
        <WebsiteCreateDialog
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
      createWebsiteAsyncMock.mockRejectedValue(
        new AppError({
          code: 'WEBSITE_DUPLICATE_DOMAIN',
          domain: 'example.com',
        }),
      );

      const { user } = render(
        <WebsiteCreateDialog
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
      createWebsiteAsyncMock.mockRejectedValue(
        new AppError({ code: 'SOMETHING_ELSE' }),
      );

      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await fillAndSubmit(user);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Couldn't add website",
            variant: 'destructive',
          }),
        ),
      );
    });
  });

  // Regression (2026-09-26 evaluation, B-05): whole-website mode sent an
  // http:// domain to the door only to be refused with a generic toast.
  describe('whole-website mode and http://', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('refuses an http:// domain inline before any request', async () => {
      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      const domain = screen.getByLabelText('Domain');
      await user.type(domain, 'http://example.net');
      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      await user.click(submit);

      await waitFor(() =>
        expect(domain).toHaveAccessibleDescription(
          /http:\/\/ addresses are not crawled/,
        ),
      );
      expect(createWebsiteAsyncMock).not.toHaveBeenCalled();
      expect(toast).not.toHaveBeenCalled();
    });
  });

  // Regression: the scheme check was case-sensitive and ran on the untrimmed
  // value, so a pasted URL with a leading space or an uppercase scheme got a
  // second `https://` prepended and was refused as an invalid domain — input
  // the server itself accepts.
  describe('a pasted URL with surrounding spaces or an uppercase scheme', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it.each([
      [' https://example.com ', 'https://example.com'],
      ['HTTPS://example.com', 'HTTPS://example.com'],
      ['  example.com', 'example.com'],
    ])('adds the whole website %j', async (pasted, sent) => {
      createWebsiteAsyncMock.mockResolvedValue('site-id');
      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      const domain = screen.getByLabelText('Domain');
      await user.click(domain);
      await user.paste(pasted);
      await user.click(
        document.querySelector('button[type="submit"]') as HTMLButtonElement,
      );

      await waitFor(() =>
        expect(createWebsiteAsyncMock).toHaveBeenCalledWith({
          organizationId: 'test-org-id',
          domain: sent,
          scanInterval: '6h',
        }),
      );
      expect(domain).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('accepts an uppercase scheme in a URL list', async () => {
      createWebsiteAsyncMock.mockResolvedValue('site-id');
      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await user.click(screen.getByRole('radio', { name: 'URL list' }));
      await user.click(screen.getByLabelText('URLs'));
      await user.paste('HTTPS://example.com/policy');
      await user.click(
        document.querySelector('button[type="submit"]') as HTMLButtonElement,
      );

      await waitFor(() =>
        expect(createWebsiteAsyncMock).toHaveBeenCalledWith({
          organizationId: 'test-org-id',
          domain: 'example.com',
          scanInterval: '6h',
          urls: ['https://example.com/policy'],
        }),
      );
    });

    it('still refuses an uppercase HTTP:// domain inline', async () => {
      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      const domain = screen.getByLabelText('Domain');
      await user.click(domain);
      await user.paste(' HTTP://example.net');
      await user.click(
        document.querySelector('button[type="submit"]') as HTMLButtonElement,
      );

      await waitFor(() =>
        expect(domain).toHaveAccessibleDescription(
          /http:\/\/ addresses are not crawled/,
        ),
      );
      expect(createWebsiteAsyncMock).not.toHaveBeenCalled();
    });
  });

  // Regression (2026-09-26 evaluation, B-04): every policy refusal read
  // "Couldn't add website" while the server's answer named the reason.
  describe('refusal reasons', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it.each([
      ['WEBSITE_DOMAIN_INVALID', /Enter a public https:\/\/ host/],
      ['WEBSITE_DOMAIN_NOT_CRAWLABLE', /The crawler cannot reach this host/],
    ])('says why a %s refusal happened', async (code, reason) => {
      createWebsiteAsyncMock.mockRejectedValue(
        new AppError({ code, message: 'server sentence' }),
      );

      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await fillAndSubmit(user);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Couldn't add website",
            description: expect.stringMatching(reason),
            variant: 'destructive',
          }),
        ),
      );
    });

    it("keeps the server's own sentence for a code it has no copy for", async () => {
      createWebsiteAsyncMock.mockRejectedValue(
        new AppError({
          code: 'WEBSITE_LIMIT_REACHED',
          message: 'This organization has reached its website limit',
        }),
      );

      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await fillAndSubmit(user);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Couldn't add website",
            description: 'This organization has reached its website limit',
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
        <WebsiteCreateDialog
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

    // Regression (2026-09-26 evaluation, B-05): the list hint said nothing
    // about the https upgrade the server applies to a listed http:// page.
    it('says listed pages are fetched over HTTPS', async () => {
      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );

      await user.click(screen.getByRole('radio', { name: 'URL list' }));
      expect(screen.getByLabelText('URLs')).toHaveAccessibleDescription(
        /fetched over HTTPS; an http:\/\/ line is fetched as https:\/\//,
      );
    });

    it('rejects an unparseable line with a field error and no calls', async () => {
      const { user } = render(
        <WebsiteCreateDialog
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
        <WebsiteCreateDialog
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

// The session door's 401 names the REST API in English; the person whose
// session ended reads why in their own language, under the localized title,
// whether one website or a URL list was being added.
describe.each(SHIPPED_LOCALES)(
  'WebsiteCreateDialog after a lapsed session (%s)',
  (locale) => {
    const t = (key: string, params?: Record<string, string>) =>
      i18n.getFixedT(locale, 'websites')(key, params);

    beforeEach(() => {
      vi.clearAllMocks();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      saveLocale(locale);
    });
    afterEach(forgetSavedLocale);

    it('says the session has ended when the website cannot be added', async () => {
      createWebsiteAsyncMock.mockImplementation(lapsedSessionRefusal);
      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await fillAndSubmit(user);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: t('toast.addError'),
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        }),
      );
      expect(JSON.stringify(vi.mocked(toast).mock.calls)).not.toContain(
        'API key',
      );
    });

    it('says the session has ended when the URL list cannot be added', async () => {
      createWebsiteAsyncMock.mockImplementation(lapsedSessionRefusal);
      const { user } = render(
        <WebsiteCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await user.click(screen.getByRole('radio', { name: t('addMode.list') }));
      await user.type(
        screen.getByLabelText(t('urlList')),
        'https://example.com/page',
      );
      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: t('toast.addListPartial', { domains: 'example.com' }),
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        }),
      );
    });
  },
);
