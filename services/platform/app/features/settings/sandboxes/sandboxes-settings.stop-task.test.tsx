import { ActiveEditorProvider, EditorGroup } from '@tale/ui/editor';
import { Toaster } from '@tale/ui/toaster';
import { toast } from '@tale/ui/use-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MockInstance } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/tests/utils/i18n-all-languages';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { SandboxesSettings } from './sandboxes-settings';

// Reads and permissions are fixtures; actions, HTTP adaptation and the toast
// viewport are real. No sandbox or process is contacted by this suite.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
  useAbilityLoading: () => false,
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-stop',
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: ReactNode }) => (
    <a href="/fixture-owner">{children}</a>
  ),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string) => ({
    data: name.endsWith(':listSandboxesForOrg')
      ? {
          sessions: [
            {
              sessionId: 'owned',
              ownerType: 'project_agent',
              ownerId: 'agent-alice',
              ownerLabel: 'Alice',
              worker: { number: 1, scope: 'agent' },
              createdBy: 'system:task-agent',
              status: 'active',
              createdAt: 1_750_000_000_000,
              pinned: false,
              busy: true,
              totalSpentCents: 0,
              currentOp: null,
              runningOps: [],
            },
          ],
          waitingRuns: { total: 0, byReason: {} },
        }
      : name.endsWith(':getSandboxDeploymentLimits')
        ? { status: 'available', maxSessions: 16 }
        : name.endsWith(':getSandboxQuotaUsage')
          ? []
          : name === 'sandbox_devices/queries:list'
            ? { devices: [], hub: 'available', serverVersion: '0.5.60' }
            : name === 'governance/queries:getPolicy'
              ? null
              : { status: 'unavailable', reason: 'not_configured' },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

const refusalCopy = {
  en: [
    'One sandbox task could not be stopped',
    '2 sandbox tasks could not be stopped',
  ],
  de: [
    'Eine Sandbox-Aufgabe konnte nicht gestoppt werden',
    '2 Sandbox-Aufgaben konnten nicht gestoppt werden',
  ],
  fr: [
    "Impossible d'arrêter une tâche de sandbox",
    "Impossible d'arrêter 2 tâches de sandbox",
  ],
} as const;

describe.each(SHIPPED_LOCALES)(
  'sandbox stop feedback through the real action (%s)',
  (locale) => {
    let client: QueryClient;
    let fetch: MockInstance<typeof window.fetch>;

    beforeEach(() => {
      saveLocale(locale);
      window.__ENV__ = { BASE_PATH: '' };
      window.history.replaceState(null, '', '/dashboard/org-stop/settings');
      client = new QueryClient({
        defaultOptions: { mutations: { retry: false } },
      });
      fetch = vi.spyOn(window, 'fetch');
    });

    afterEach(async () => {
      cleanup();
      // The native toast store outlives a mounted viewport. Replace its
      // previous entry so the next case cannot read an earlier outcome.
      toast({}).dismiss();
      client.clear();
      vi.restoreAllMocks();
      delete window.__ENV__;
      window.history.replaceState(null, '', '/');
      await forgetSavedLocale();
    });

    async function stopWith(response: Response) {
      fetch.mockImplementation(async (input) => {
        if (input === '/api/app/sandbox/reconcile?orgId=org-stop') {
          return Response.json({ reconciled: 0 });
        }
        if (
          input === '/api/app/sandbox/sessions/owned/stop-task?orgId=org-stop'
        ) {
          return response;
        }
        throw new Error('Unexpected sandbox settings request');
      });
      const { user } = render(
        <QueryClientProvider client={client}>
          <ActiveEditorProvider>
            <EditorGroup>
              <SandboxesSettings organizationId="org-stop" />
            </EditorGroup>
          </ActiveEditorProvider>
          <Toaster />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(i18n.language).toBe(locale));
      await waitFor(() => expect(client.isMutating()).toBe(0));
      const row = screen.getByText('Alice').closest('tr');
      if (row === null) throw new Error('Alice workspace is missing');
      const menu = within(row).getByRole('button', {
        name: i18n.getFixedT(locale, 'common')('actions.openMenu'),
      });
      act(() => menu.focus());
      await user.keyboard('{Enter}');
      await user.click(
        await screen.findByRole('menuitem', {
          name: i18n.getFixedT(locale, 'sandboxes')('actions.stop'),
        }),
      );
      await waitFor(() =>
        expect(
          fetch.mock.calls.filter(
            ([url]) => typeof url === 'string' && url.includes('/stop-task'),
          ),
        ).toHaveLength(1),
      );
    }

    it.each([
      [{ cancelled: 0, refused: 1 }, 0],
      [{ cancelled: 1, refused: 1 }, 0],
      [{ cancelled: 1, refused: 2 }, 1],
    ] as const)(
      'renders a localized refusal for %j',
      async (answer, copyIndex) => {
        await stopWith(Response.json(answer));
        await screen.findByText(refusalCopy[locale][copyIndex]);
        expect(document.body.querySelectorAll('ol li')).toHaveLength(1);
        expect(document.body.querySelector('ol li svg')).toHaveClass(
          'text-destructive',
        );
        expect(document.body.querySelector('ol')).toHaveTextContent(
          i18n.getFixedT(locale, 'sandboxes')('toast.error'),
        );
        expect(document.body.querySelector('ol')).not.toHaveTextContent(
          i18n.getFixedT(locale, 'sandboxes')('toast.stopped'),
        );
      },
    );

    it('renders success only after all stops are confirmed', async () => {
      await stopWith(Response.json({ cancelled: 2, refused: 0 }));
      await screen.findByText(
        i18n.getFixedT(locale, 'sandboxes')('toast.stopped'),
      );
      expect(document.body.querySelector('ol li svg')).toBeNull();
    });

    it('renders app-503 as a failure without exposing its payload', async () => {
      await stopWith(
        Response.json({ error: 'private-fault-detail' }, { status: 503 }),
      );
      await screen.findByText(
        i18n.getFixedT(locale, 'sandboxes')('toast.error'),
      );
      expect(document.body.querySelector('ol li svg')).toHaveClass(
        'text-destructive',
      );
      expect(document.body.querySelector('ol')).not.toHaveTextContent(
        'private-fault-detail',
      );
      expect(document.body.querySelector('ol')).not.toHaveTextContent(
        i18n.getFixedT(locale, 'sandboxes')('toast.stopped'),
      );
    });
  },
);
