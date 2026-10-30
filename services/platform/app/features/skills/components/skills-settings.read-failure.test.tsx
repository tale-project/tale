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
  within,
} from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { SkillsSettings } from './skills-settings';

/**
 * Settings › Skills over its real reads: `useSkills` and the team directory,
 * their adapter rows, `backendFetch` and the read retry policy (four attempts
 * for a fault) against a closed synthetic transport. A library read that
 * failed is the table's error state with **Try again**, never "No skills yet"
 * with **Add skill**; a failed refresh is named above the rows it left; and a
 * team-shared skill reads as **Teams** until the directory answers, never as
 * "Unknown team" (#4888).
 */

// The real retry policy makes four attempts before a failure settles; on a
// loaded runner that outlasts the default one-second wait.
configure({ asyncUtilTimeout: 10_000 });

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
// The panes have suites of their own, and none opens here.
vi.mock('./skill-create-dialog', () => ({ SkillCreateDialog: () => null }));
vi.mock('./skill-upload-dialog', () => ({ SkillUploadDialog: () => null }));
vi.mock('./skill-pane-dialog', () => ({ SkillDetailDialog: () => null }));

const SKILLS = /^GET \/api\/app\/skills\?orgId=org-1$/;
const DIRECTORY = /^GET \/api\/app\/teams\/directory\?orgId=org-1$/;

const RED = { id: 'team-red', name: 'Red' };
const BLUE = { id: 'team-blue', name: 'Blue' };

type Sharing = { visibility: 'org' } | { visibility: 'team'; teams: string[] };

function skill(slug: string, sharing: Sharing = { visibility: 'org' }) {
  return {
    slug,
    description: `What ${slug} covers`,
    ...sharing,
    origin: 'member',
    owner: 'user-ada',
    ownerName: 'Ada Lovelace',
    canEdit: true,
    etag: `"${slug}"`,
    updatedAt: 1,
  };
}

function skillsAnswer(...skills: ReturnType<typeof skill>[]) {
  return () =>
    Response.json({
      skills,
      failures: [],
      publishing: { mode: 'everyone', allowed: true },
    });
}

function directoryAnswer(...teams: { id: string; name: string }[]) {
  return () => Response.json({ teams });
}

let backend: SyntheticBackend;
let client: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/dashboard/org-1/settings/skills');
  backend = syntheticBackend();
  backend.on(DIRECTORY, directoryAnswer(RED, BLUE));
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

async function renderPage() {
  const view = render(
    <QueryClientProvider client={client}>
      <SkillsSettings organizationId="org-1" />
    </QueryClientProvider>,
  );
  // The app shell settles its language once mounted; let that land in act.
  await act(async () => {});
  return view;
}

/** The section the page lists its skills in — where a Try again that gave
 * way hands its focus. */
function skillsSection(): HTMLElement {
  return screen.getByRole('region', {
    name: i18n.t('skills', { ns: 'navigation' }),
  });
}

/** The table's error state's retry, once the read's policy has given up. */
async function tableRetry(): Promise<HTMLElement> {
  return screen.findByRole('button', {
    name: i18n.t('errors.tryAgain', { ns: 'common' }),
  });
}

const noSkillsYet = () => i18n.t('skills.title', { ns: 'emptyStates' });
const addSkill = () => i18n.t('addMenu.label', { ns: 'skills' });
const refreshFailed = () => i18n.t('library.refreshFailed', { ns: 'skills' });
const teamsBadge = () => i18n.t('visibility.team', { ns: 'skills' });
const unknownTeam = () => i18n.t('visibility.unknownTeam', { ns: 'skills' });

/** The alert that says `message`, once it does. */
async function alertSaying(message: string): Promise<HTMLElement> {
  const alert = (await screen.findByText(message)).closest<HTMLElement>(
    '[role="alert"]',
  );
  if (alert === null) throw new Error(`"${message}" is in no alert`);
  return alert;
}

/** The Visibility cell of the row a skill's name button sits in. */
function visibilityOf(slug: string): string | null {
  const row = screen.getByRole('button', { name: slug }).closest('tr');
  if (row === null) throw new Error(`no row for ${slug}`);
  const header = screen.getByRole('columnheader', {
    name: i18n.t('columns.visibility', { ns: 'skills' }),
  });
  const column = [...(header.parentElement?.children ?? [])].indexOf(header);
  return within(row).getAllByRole('cell')[column]?.textContent ?? null;
}

describe(
  'SkillsSettings when its library read fails',
  { timeout: 30_000 },
  () => {
    it('shows the table’s error state with Try again instead of “No skills yet”, and recovers from the keyboard', async () => {
      backend.on(SKILLS, serviceUnavailable);
      const { user } = await renderPage();

      await waitFor(() => expect(backend.count(SKILLS)).toBe(4));
      const retry = await tableRetry();
      // A library that never answered is not an empty one: no "No skills yet",
      // no Add skill to write a first one, and no table.
      expect(screen.queryByText(noSkillsYet())).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: addSkill() }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(backend.count(SKILLS)).toBe(4);

      backend.on(SKILLS, skillsAnswer(skill('house-voice')));
      retry.focus();
      await user.keyboard('{Enter}');

      expect(
        await screen.findByRole('button', { name: 'house-voice' }),
      ).toBeInTheDocument();
      expect(backend.count(SKILLS)).toBe(5);
      // Try again gave way to the rows: its focus is on the skills' section,
      // not lost to the page.
      await waitFor(() => expect(skillsSection()).toHaveFocus());
    });

    it('keeps the rows a failed refresh left, names the failure above them, and heals on Try again', async () => {
      backend.on(SKILLS, skillsAnswer(skill('house-voice')));
      const { user } = await renderPage();
      expect(
        await screen.findByRole('button', { name: 'house-voice' }),
      ).toBeInTheDocument();

      backend.on(SKILLS, serviceUnavailable);
      await act(async () => {
        await client.refetchQueries();
      });
      await waitFor(() => expect(backend.count(SKILLS)).toBe(5));

      const alert = await alertSaying(refreshFailed());
      expect(
        screen.getByRole('button', { name: 'house-voice' }),
      ).toBeInTheDocument();
      expect(skillsSection()).toContainElement(alert);

      backend.on(
        SKILLS,
        skillsAnswer(skill('house-voice'), skill('legal-review')),
      );
      const retry = within(alert).getByRole('button', {
        name: i18n.t('actions.tryAgain', { ns: 'common' }),
      });
      retry.focus();
      await user.keyboard('{Enter}');

      expect(
        await screen.findByRole('button', { name: 'legal-review' }),
      ).toBeInTheDocument();
      expect(screen.queryByText(refreshFailed())).not.toBeInTheDocument();
      await waitFor(() => expect(skillsSection()).toHaveFocus());
    });

    it('keeps a facet that matches nothing a no-match while a refresh has failed, not a second error', async () => {
      backend.on(SKILLS, skillsAnswer(skill('house-voice')));
      const { user } = await renderPage();
      await screen.findByRole('button', { name: 'house-voice' });
      backend.on(SKILLS, serviceUnavailable);
      await act(async () => {
        await client.refetchQueries();
      });
      const alert = await alertSaying(refreshFailed());

      // The library holds no team skill, so the Teams facet narrows the rows
      // the page lists to none.
      await user.click(screen.getByRole('button', { name: /filter/i }));
      await user.click(
        screen.getByRole('button', {
          name: new RegExp(
            i18n.t('library.scopeFilterLabel', { ns: 'skills' }),
            'i',
          ),
        }),
      );
      await user.click(
        screen.getByRole('checkbox', {
          name: i18n.t('library.tabs.team', { ns: 'skills' }),
        }),
      );

      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'house-voice' }),
        ).not.toBeInTheDocument(),
      );
      // The failure stays the one notice above the table; the table does not
      // turn into an error state of its own for a narrowing.
      expect(
        screen.queryByText(
          i18n.t('errors.somethingWentWrong', { ns: 'common' }),
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByRole('button', {
          name: i18n.t('actions.tryAgain', { ns: 'common' }),
        }),
      ).toEqual([within(alert).getByRole('button')]);
    });

    it.each(SHIPPED_LOCALES)(
      'names a failed read and a failed refresh in %s and passes axe',
      async (locale) => {
        saveLocale(locale);
        backend.on(SKILLS, serviceUnavailable);
        const { container } = await renderPage();
        await waitFor(() => expect(i18n.resolvedLanguage).toBe(locale));

        await tableRetry();
        expect(screen.queryByText(noSkillsYet())).not.toBeInTheDocument();
        await checkAccessibility(container);

        backend.on(SKILLS, skillsAnswer(skill('house-voice')));
        await act(async () => {
          await client.refetchQueries();
        });
        await screen.findByRole('button', { name: 'house-voice' });
        backend.on(SKILLS, serviceUnavailable);
        await act(async () => {
          await client.refetchQueries();
        });

        await alertSaying(refreshFailed());
        await checkAccessibility(container);
      },
    );
  },
);

describe('SkillsSettings team badges', { timeout: 30_000 }, () => {
  const TEAM_SKILLS = [
    skill('red-notes', { visibility: 'team', teams: [RED.id] }),
    skill('shared-notes', { visibility: 'team', teams: [RED.id, BLUE.id] }),
  ];

  it('reads a team skill as Teams while the directory loads, then names its teams', async () => {
    let answerDirectory: () => void = () => {};
    backend.on(
      DIRECTORY,
      () =>
        new Promise<Response>((resolve) => {
          answerDirectory = () => resolve(directoryAnswer(RED, BLUE)());
        }),
    );
    backend.on(SKILLS, skillsAnswer(...TEAM_SKILLS));
    await renderPage();
    await screen.findByRole('button', { name: 'red-notes' });

    expect(visibilityOf('red-notes')).toBe(teamsBadge());
    expect(visibilityOf('shared-notes')).toBe(teamsBadge());
    expect(
      screen.queryByText(unknownTeam(), { exact: false }),
    ).not.toBeInTheDocument();

    await act(async () => {
      answerDirectory();
    });
    await waitFor(() => expect(visibilityOf('red-notes')).toBe('Red'));
    expect(visibilityOf('shared-notes')).toBe('Red +1');
  });

  it('keeps reading Teams, never Unknown team, once the directory read failed', async () => {
    backend.on(DIRECTORY, serviceUnavailable);
    backend.on(SKILLS, skillsAnswer(...TEAM_SKILLS));
    await renderPage();
    await screen.findByRole('button', { name: 'red-notes' });
    await waitFor(() => expect(backend.count(DIRECTORY)).toBe(4));
    await act(async () => {});

    expect(visibilityOf('red-notes')).toBe(teamsBadge());
    expect(visibilityOf('shared-notes')).toBe(teamsBadge());
    expect(
      screen.queryByText(unknownTeam(), { exact: false }),
    ).not.toBeInTheDocument();
  });

  it('calls a team unknown only once the directory answered without it', async () => {
    backend.on(DIRECTORY, directoryAnswer(BLUE));
    backend.on(SKILLS, skillsAnswer(...TEAM_SKILLS));
    await renderPage();
    await screen.findByRole('button', { name: 'red-notes' });

    await waitFor(() => expect(visibilityOf('red-notes')).toBe(unknownTeam()));
    expect(visibilityOf('shared-notes')).toBe(`${unknownTeam()} +1`);
  });
});
