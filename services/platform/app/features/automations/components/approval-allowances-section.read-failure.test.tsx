import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
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

import { ApprovalAllowancesSection } from './approval-allowances-section';

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

// #4766: a failed read of the writes an automation may make without
// approval read as "This automation makes no write that waits for
// approval." — a verdict about a governance setting the page never
// established, with no way to try again. The read runs for real here (hook,
// adapter row, `backendFetch`, the four-attempt retry policy) against a
// closed synthetic transport.

const ALLOWANCES =
  /^GET \/api\/app\/automations\/morning-digest\/approval-allowances\?orgId=org-1$/;
const NODE_TYPES =
  /^GET \/api\/app\/automations\/catalog\/node-types\?orgId=org-1$/;

const SLACK_SEND = {
  type: 'slack.send_message',
  used: true,
  policy: null,
  allowance: null,
};

/** A healthy answer: the writes, and an owner or admin reading them. */
function allowances(actions: object[] = [SLACK_SEND]): Response {
  return Response.json({ actions, canGrant: true });
}

/** What the app door answers when its handler throws (`appErrorHandler`). */
function internalError(): Response {
  return new Response('Internal Server Error', { status: 500 });
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  backend = syntheticBackend();
  backend.on(NODE_TYPES, () =>
    Response.json({
      nodeTypes: [],
      connectors: [{ name: 'slack', displayName: 'Slack' }],
    }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});

afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

/** The section as the General tab holds it, in the page's editor group. */
function renderSection() {
  return render(
    <QueryClientProvider client={client}>
      <ActiveEditorProvider>
        <EditorGroup>
          <ApprovalAllowancesSection
            organizationId="org-1"
            name="morning-digest"
          />
        </EditorGroup>
      </ActiveEditorProvider>
    </QueryClientProvider>,
  );
}

const t = (key: string) => i18n.t(key, { ns: 'automations' });
const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const section = () =>
  screen.getByRole('region', { name: t('allowances.title') });
const none = () => within(section()).queryByText(t('allowances.none'));
const slackSwitch = () =>
  within(section()).findByRole('switch', { name: /Slack · Send message/ });

describe(
  'ApprovalAllowancesSection when the allowances read fails',
  { timeout: 30_000 },
  () => {
    it('says the writes could not load, never that there are none', async () => {
      backend.on(ALLOWANCES, () => internalError());
      renderSection();

      // The policy's four attempts, then a settled failure.
      await waitFor(() => expect(backend.count(ALLOWANCES)).toBe(4));
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(none()).not.toBeInTheDocument();

      const alert = await within(section()).findByRole('alert');
      expect(alert).toHaveTextContent(t('allowances.loadFailed'));
      expect(
        within(alert).getByRole('button', { name: tryAgain() }),
      ).toBeInTheDocument();
      expect(within(section()).queryByRole('switch')).not.toBeInTheDocument();
      // The section keeps its title and hint.
      expect(section()).toHaveAccessibleDescription(t('allowances.hint'));
    });

    it('says nothing about the writes while the first read runs', async () => {
      let answer: (response: Response) => void = () => {};
      backend.on(
        ALLOWANCES,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      renderSection();
      await waitFor(() => expect(backend.count(ALLOWANCES)).toBe(1));

      expect(none()).not.toBeInTheDocument();
      expect(within(section()).queryByRole('switch')).not.toBeInTheDocument();

      answer(allowances());
      expect(await slackSwitch()).not.toBeChecked();
      expect(none()).not.toBeInTheDocument();
    });

    it('lists the writes when Try again works from the keyboard, and hands the focus to the section', async () => {
      backend.on(ALLOWANCES, () => internalError());
      const { user } = renderSection();
      const alert = await within(section()).findByRole('alert');

      backend.on(ALLOWANCES, () => allowances());
      within(alert).getByRole('button', { name: tryAgain() }).focus();
      await user.keyboard('{Enter}');

      expect(await slackSwitch()).not.toBeChecked();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      expect(none()).not.toBeInTheDocument();
      // The Try again that held the focus is gone: the focus is on the
      // section, which keeps its name, not on the page.
      await waitFor(() => expect(section()).toHaveFocus());
    });

    it('keeps Try again, and the focus on it, while it runs and when it fails again', async () => {
      backend.on(ALLOWANCES, () => internalError());
      const { user } = renderSection();
      const alert = await within(section()).findByRole('alert');
      const retry = within(alert).getByRole('button', { name: tryAgain() });

      let answer: (response: Response) => void = () => {};
      backend.on(
        ALLOWANCES,
        () => new Promise<Response>((resolve) => (answer = resolve)),
      );
      await user.click(retry);

      // react-query resets a read that never answered to `pending` as the
      // retry starts; the notice holds still, its button busy and focused,
      // and nothing masks it as a section still loading.
      await waitFor(() => expect(retry).toHaveAttribute('aria-busy', 'true'));
      expect(retry).toHaveFocus();
      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(alert.closest('[aria-busy="true"]')).toBeNull();
      expect(none()).not.toBeInTheDocument();

      backend.on(ALLOWANCES, () => internalError());
      answer(internalError());
      await waitFor(() => expect(backend.count(ALLOWANCES)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));

      expect(within(section()).getByRole('alert')).toBe(alert);
      expect(within(alert).getByRole('button', { name: tryAgain() })).toBe(
        retry,
      );
      expect(retry).toHaveFocus();
      expect(none()).not.toBeInTheDocument();
      expect(within(section()).queryByRole('switch')).not.toBeInTheDocument();
    });

    it('keeps "no write that waits for approval" for a read that answered with none', async () => {
      backend.on(ALLOWANCES, () => allowances([]));
      renderSection();

      expect(
        await within(section()).findByText(t('allowances.none')),
      ).toBeInTheDocument();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      expect(
        within(section()).queryByRole('button', { name: tryAgain() }),
      ).not.toBeInTheDocument();
      expect(backend.count(ALLOWANCES)).toBe(1);
    });

    it('keeps the writes through a failed refresh and says they may be out of date', async () => {
      backend.on(ALLOWANCES, () => allowances());
      const { user } = renderSection();
      const slack = await slackSwitch();
      expect(slack).not.toBeChecked();

      backend.on(ALLOWANCES, () => internalError());
      void client.invalidateQueries();
      const alert = await within(section()).findByRole('alert');
      expect(alert).toHaveTextContent(t('allowances.refreshFailed'));
      expect(await slackSwitch()).toBe(slack);
      expect(none()).not.toBeInTheDocument();

      // Meanwhile an admin allowed the write in another session.
      backend.on(ALLOWANCES, () =>
        allowances([
          {
            ...SLACK_SEND,
            allowance: {
              grantedBy: 'u-ada',
              grantedByName: 'Ada Lovelace',
              grantedAt: Date.UTC(2026, 9, 9),
            },
          },
        ]),
      );
      await user.click(within(alert).getByRole('button', { name: tryAgain() }));
      await waitFor(() => expect(slack).toBeChecked());
      expect(
        within(section()).getByText(/Allowed by Ada Lovelace on/),
      ).toBeVisible();
      expect(within(section()).queryByRole('alert')).not.toBeInTheDocument();
      await waitFor(() => expect(section()).toHaveFocus());
    });

    it('passes an axe audit with the failure shown', async () => {
      backend.on(ALLOWANCES, () => internalError());
      const { container } = renderSection();
      await within(section()).findByRole('alert');

      await checkAccessibility(container);
    });

    describe.each(SHIPPED_LOCALES)('in %s', (locale) => {
      it('names the failed read and its retry in the reader language', async () => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        backend.on(ALLOWANCES, () => internalError());
        renderSection();

        const alert = await within(section()).findByRole('alert');
        expect(alert).toHaveTextContent(t('allowances.loadFailed'));
        expect(
          within(alert).getByRole('button', { name: tryAgain() }),
        ).toBeInTheDocument();
        for (const key of [
          'allowances.loadFailed',
          'allowances.refreshFailed',
        ]) {
          expect(t(key)).not.toBe(key);
          // A translation of its own, not the English fallback.
          if (locale !== 'en') {
            expect(t(key)).not.toBe(
              i18n.t(key, { ns: 'automations', lng: 'en' }),
            );
          }
        }
      });
    });
  },
);
