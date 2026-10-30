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
  cleanup,
  configure,
  render,
  screen,
  waitFor,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import type { ApiKeyRole } from '../types';
import {
  type ApiKeyOwnerChoice,
  ApiKeyOwnerField,
} from './api-key-owner-field';

/**
 * The **Belongs to** pickers over their real reads: the hooks, adapter rows,
 * `backendFetch` and the read retry policy (four attempts for a fault)
 * against a closed synthetic transport. A list that has not answered never
 * says nobody qualifies (#4586).
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function projectRow(id: string, name: string) {
  return {
    id,
    organizationId: 'org-1',
    name,
    description: null,
    icon: null,
    color: null,
    key: null,
    externalItemId: null,
    taskCounter: 0,
    openTaskCount: 0,
    doneTaskCount: 0,
    projectAgentCount: 0,
    teamId: null,
    sharedWithTeamIds: [],
    teamIds: [],
    instructions: null,
    createdBy: 'ada',
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
    pinnedAt: null,
    isOrgWide: true,
    canEdit: true,
    canAdminister: true,
  };
}

const TARGETS = [
  {
    choice: 'member',
    picker: 'api-key-member',
    door: /^GET \/api\/app\/members\?orgId=org-1$/,
    answer: () =>
      Response.json({
        members: [
          {
            userId: 'ada',
            role: 'admin',
            joinedAt: 1,
            displayName: 'Ada',
            email: 'ada@example.test',
          },
          {
            userId: 'mia',
            role: 'member',
            joinedAt: 2,
            displayName: 'Mia Keller',
            email: 'mia@example.test',
          },
        ],
      }),
    candidate: /Mia Keller/,
    emptyKey: 'apiKeys.form.memberEmpty',
    failed: {
      en: "Couldn't load the members.",
      de: 'Die Mitglieder konnten nicht geladen werden.',
      fr: 'Impossible de charger les membres.',
    },
  },
  {
    choice: 'team',
    picker: 'api-key-team',
    door: /^GET \/api\/app\/teams\?orgId=org-1$/,
    answer: () =>
      Response.json({
        teams: [
          { id: 'finance', name: 'Finance', memberCount: 2, createdAt: 1 },
        ],
      }),
    candidate: /Finance/,
    emptyKey: 'apiKeys.form.teamEmpty',
    failed: {
      en: "Couldn't load the teams.",
      de: 'Die Teams konnten nicht geladen werden.',
      fr: 'Impossible de charger les équipes.',
    },
  },
  {
    choice: 'project',
    picker: 'api-key-project',
    door: /^GET \/api\/app\/projects\?includeArchived=false&summary=true&orgId=org-1$/,
    answer: () => Response.json({ projects: [projectRow('launch', 'Launch')] }),
    candidate: /Launch/,
    emptyKey: 'apiKeys.form.projectEmpty',
    failed: {
      en: "Couldn't load the projects.",
      de: 'Die Projekte konnten nicht geladen werden.',
      fr: 'Impossible de charger les projets.',
    },
  },
] satisfies Array<{
  choice: ApiKeyOwnerChoice;
  picker: string;
  door: RegExp;
  answer: () => Response;
  candidate: RegExp;
  emptyKey: string;
  failed: Record<'en' | 'de' | 'fr', string>;
}>;

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/settings/api/rest');
  backend = syntheticBackend();
  // No backoff between the policy's attempts; the attempt count is real.
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});
afterEach(async () => {
  // Unmount before the language is put back, so no mounted label re-renders
  // outside act.
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});

/** The role a team's or a project's key acts with — not an ARIA role. */
const KEY_ROLE: ApiKeyRole = 'member';

async function renderField(choice: ApiKeyOwnerChoice) {
  const view = render(
    <QueryClientProvider client={client}>
      <ApiKeyOwnerField
        organizationId="org-1"
        viewerUserId="ada"
        viewerRole="admin"
        choice={choice}
        onChoiceChange={vi.fn()}
        memberId=""
        onMemberChange={vi.fn()}
        teamId=""
        onTeamChange={vi.fn()}
        projectId=""
        onProjectChange={vi.fn()}
        role={KEY_ROLE}
        onRoleChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return view;
}

function pickerTrigger(id: string): HTMLElement {
  const trigger = document.getElementById(id);
  if (trigger === null) throw new Error(`No picker #${id}`);
  return trigger;
}

/** The alert that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(message)).closest<HTMLElement>(
    '[role="alert"]',
  );
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

const tryAgain = () => i18n.t('actions.tryAgain', { ns: 'common' });
const settingsText = (key: string) => i18n.t(key, { ns: 'settings' });

describe.each(TARGETS)(
  'the $choice picker when its list read fails',
  { timeout: 30_000 },
  ({ choice, picker, door, answer, candidate, emptyKey, failed }) => {
    it('never offers an empty list, names the failure with Try again, and recovers from the keyboard', async () => {
      backend.on(door, serviceUnavailable);
      const { user } = await renderField(choice);

      // The policy's four attempts; meanwhile and after them, the picker
      // offers no list that could say nobody qualifies.
      await waitFor(() => expect(backend.count(door)).toBe(4));
      await user.click(pickerTrigger(picker));
      expect(
        screen.queryByText(settingsText(emptyKey)),
      ).not.toBeInTheDocument();

      const alert = await alertSaying(failed.en);
      expect(pickerTrigger(picker)).toBeDisabled();
      expect(backend.count(door)).toBe(4);

      // Try again reads the list once more; the alert gives way to the
      // picker, which takes the focus Try again held.
      backend.on(door, answer);
      const retry = screen.getByRole('button', { name: tryAgain() });
      expect(alert).toContainElement(retry);
      retry.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(pickerTrigger(picker)).toHaveFocus());
      expect(screen.queryByText(failed.en)).not.toBeInTheDocument();
      expect(pickerTrigger(picker)).toBeEnabled();
      expect(backend.count(door)).toBe(5);

      await user.click(pickerTrigger(picker));
      expect(
        screen.getByRole('option', { name: candidate }),
      ).toBeInTheDocument();
    });

    it('keeps the failure and the focus on Try again while a retry fails again', async () => {
      backend.on(door, serviceUnavailable);
      const { user } = await renderField(choice);
      await alertSaying(failed.en);

      const retry = screen.getByRole('button', { name: tryAgain() });
      retry.focus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(backend.count(door)).toBe(8));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-busy'));
      expect(screen.getByText(failed.en)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: tryAgain() })).toBe(retry);
      expect(retry).toHaveFocus();
      expect(pickerTrigger(picker)).toBeDisabled();
    });

    it('masks the picker while the first read is pending, then offers what it answered', async () => {
      let release = () => {};
      backend.on(
        door,
        () =>
          new Promise<Response>((resolve) => {
            release = () => resolve(answer());
          }),
      );
      const { user } = await renderField(choice);
      await waitFor(() => expect(backend.count(door)).toBe(1));

      await user.click(pickerTrigger(picker));
      expect(
        screen.queryByText(settingsText(emptyKey)),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(failed.en)).not.toBeInTheDocument();
      expect(pickerTrigger(picker)).toBeDisabled();
      expect(pickerTrigger(picker)).toHaveAttribute('aria-hidden', 'true');

      await act(async () => release());
      await waitFor(() => expect(pickerTrigger(picker)).toBeEnabled());
      expect(pickerTrigger(picker)).not.toHaveAttribute('aria-hidden');
      await user.click(pickerTrigger(picker));
      expect(
        screen.getByRole('option', { name: candidate }),
      ).toBeInTheDocument();
    });

    it.each(SHIPPED_LOCALES)(
      'names the failure in %s and passes axe',
      async (locale) => {
        saveLocale(locale);
        backend.on(door, serviceUnavailable);
        const { container } = await renderField(choice);

        const alert = await alertSaying(failed[locale]);
        expect(alert).toContainElement(
          screen.getByRole('button', { name: tryAgain() }),
        );
        await checkAccessibility(container);
      },
    );
  },
);
