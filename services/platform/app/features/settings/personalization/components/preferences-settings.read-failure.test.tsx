import {
  ActiveEditorProvider,
  useActiveEditor,
  type EditorController,
} from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  act,
  configure,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';
import {
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { PreferencesSettings } from './preferences-settings';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4889: a person who never chose follows the organization's
// `custom_instructions` default, which the page reads apart from their own
// preferences. While that read ran, and after it failed, the page took the
// default for off: an unchecked switch, "Following organization default
// (off).", and the saved instructions hidden while chat kept applying them.
// Both reads run for real here (hooks, adapter rows, `backendFetch`, the
// four-attempt retry policy) against a closed synthetic transport.

const PREFERENCES = /^GET \/api\/app\/user-preferences\?orgId=org-1$/;
const POLICY =
  /^GET \/api\/app\/governance\/policies\/custom_instructions\?orgId=org-1$/;

/** A person who saved instructions but never chose on or off. */
function noChoice(): Response {
  return Response.json({
    preferences: {
      _id: 'pref-1',
      _creationTime: 0,
      organizationId: 'org-1',
      userId: 'user-1',
      updatedAt: 0,
      customInstructions: 'Reply in French.',
    },
  });
}

/** The organization's default, as the governance door answers it. */
function orgDefault(enabled: boolean): Response {
  return Response.json({
    policy: { key: 'custom_instructions', config: { enabled } },
  });
}

/** What the app door answers when its handler throws (`appErrorHandler`). */
function internalError(): Response {
  return new Response('Internal Server Error', { status: 500 });
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  backend.on(PREFERENCES, () => noChoice());
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

/** The page in the settings shell's editor scope; `capture` holds the
 * editor the header's Save would run, if any registered. */
function renderPage() {
  const capture = { current: null as EditorController | null };
  function ActiveProbe() {
    capture.current = useActiveEditor();
    return null;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <ActiveEditorProvider>
        <ActiveProbe />
        <PreferencesSettings organizationId="org-1" />
      </ActiveEditorProvider>
    </QueryClientProvider>,
  );
  return { capture, ...view };
}

const t = (key: string, options?: Record<string, unknown>) =>
  i18n.t(key, { ns: 'personalization', ...options });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const following = (state: 'orgStateOn' | 'orgStateOff') =>
  t('page.enable.followingOrgDefault', { state: t(`page.enable.${state}`) });
const section = () =>
  screen.getByRole('region', { name: t('page.customInstructions.title') });
// The section the switch comes in is a new element, so it is looked up on
// the screen rather than inside the section that held the skeleton or alert.
const findSwitch = () =>
  screen.findByRole('switch', {
    name: t('page.customInstructionsToggle.label'),
  });

/** Nothing on the page claims the feature is on or off. */
function expectNoClaim(capture: { current: EditorController | null }) {
  expect(screen.queryByText(following('orgStateOff'))).not.toBeInTheDocument();
  expect(screen.queryByText(following('orgStateOn'))).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(capture.current).toBeNull();
}

describe(
  'PreferencesSettings when the organization default cannot be read',
  { timeout: 30_000 },
  () => {
    it('never says the default is off after its read failed, and Try again recovers it', async () => {
      backend.on(POLICY, () => internalError());
      const { capture, user } = renderPage();

      // The policy's four attempts, then a settled failure.
      await waitFor(() => expect(backend.count(POLICY)).toBe(4));
      await waitFor(() => expect(client.isFetching()).toBe(0));
      const alert = await within(section()).findByRole('alert');
      expect(alert).toHaveTextContent(t('errors.orgDefaultLoadFailed'));
      expect(alert.closest('[aria-busy="true"]')).toBeNull();
      expectNoClaim(capture);
      // The section keeps its title and its description, with no hint.
      expect(section()).toHaveAccessibleDescription(
        t('page.customInstructionsToggle.description'),
      );

      // Try again reads the default again, and only the default.
      backend.on(POLICY, () => orgDefault(true));
      const preferenceReads = backend.count(PREFERENCES);
      within(alert).getByRole('button', { name: tryAgain() }).focus();
      await user.keyboard('{Enter}');

      const toggle = await findSwitch();
      expect(toggle).toBeChecked();
      expect(screen.getByText(following('orgStateOn'))).toBeVisible();
      expect(
        screen.getByRole('textbox', {
          name: t('page.customInstructions.title'),
        }),
      ).toHaveValue('Reply in French.');
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      expect(backend.count(PREFERENCES)).toBe(preferenceReads);
      // The Try again that held the focus is gone: the focus is on the
      // section, not on the page.
      await waitFor(() => expect(section()).toHaveFocus());
    });

    it('says nothing about the default while its read runs', async () => {
      let answer: (response: Response) => void = () => {};
      backend.on(
        POLICY,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      const { capture } = renderPage();
      // The preferences have answered; the default has not.
      await waitFor(() => expect(backend.count(POLICY)).toBe(1));
      await waitFor(() => expect(client.isFetching()).toBe(1));

      expect(
        screen.getByRole('status', { name: t('page.title') }),
      ).toHaveAttribute('aria-busy', 'true');
      expectNoClaim(capture);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await act(async () => answer(orgDefault(true)));
      expect(await findSwitch()).toBeChecked();
      expect(screen.getByText(following('orgStateOn'))).toBeVisible();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('keeps Try again, and the focus on it, while it runs and when it fails again', async () => {
      backend.on(POLICY, () => internalError());
      const { capture, user } = renderPage();
      const alert = await within(section()).findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      let answer: (response: Response) => void = () => {};
      backend.on(
        POLICY,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      await user.click(retry);

      // react-query resets a read that never answered to `pending` as the
      // retry starts; the notice holds still, its button busy and focused,
      // and nothing masks it as a page still loading or calls the default
      // off.
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(retry).toHaveFocus();
      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(alert.closest('[aria-busy="true"]')).toBeNull();
      expectNoClaim(capture);

      backend.on(POLICY, () => internalError());
      answer(internalError());
      await waitFor(() => expect(backend.count(POLICY)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(
        retry,
      );
      expect(retry).toHaveFocus();
      expectNoClaim(capture);
    });

    it('names the preferences first when both reads fail, and Try again reads both', async () => {
      backend.on(PREFERENCES, () => internalError());
      backend.on(POLICY, () => internalError());
      const { capture, user } = renderPage();

      await waitFor(() => expect(backend.count(PREFERENCES)).toBe(4));
      await waitFor(() => expect(backend.count(POLICY)).toBe(4));
      await waitFor(() => expect(client.isFetching()).toBe(0));
      const alert = await within(section()).findByRole('alert');
      expect(alert).toHaveTextContent(t('errors.loadFailed'));
      expectNoClaim(capture);

      backend.on(PREFERENCES, () => noChoice());
      backend.on(POLICY, () => orgDefault(true));
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));

      expect(await findSwitch()).toBeChecked();
      expect(backend.count(PREFERENCES)).toBe(5);
      expect(backend.count(POLICY)).toBe(5);
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('still follows an organization that set no default: off', async () => {
      backend.on(POLICY, () => Response.json({ policy: null }));
      renderPage();

      const toggle = await findSwitch();
      expect(toggle).not.toBeChecked();
      expect(toggle).toBeEnabled();
      expect(screen.getByText(following('orgStateOff'))).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(backend.count(POLICY)).toBe(1);
    });

    it('passes an axe audit with the failure shown', async () => {
      backend.on(POLICY, () => internalError());
      const { container } = renderPage();
      await within(section()).findByRole('alert');

      await checkAccessibility(container);
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failed default and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(POLICY, () => internalError());
        const { capture } = renderPage();

        const alert = await within(section()).findByRole('alert');
        expect(alert).toHaveTextContent(t('errors.orgDefaultLoadFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        expectNoClaim(capture);
        const key = 'errors.orgDefaultLoadFailed';
        expect(t(key)).not.toBe(key);
        // A translation of its own, not the English fallback.
        if (locale !== 'en') {
          expect(t(key)).not.toBe(t(key, { lng: 'en' }));
        }
      });
    });
  },
);
