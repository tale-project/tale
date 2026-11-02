// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MemberLookupTarget } from '@/app/features/settings/organization/hooks/member-lookup';
import type { StandInMember } from '@/tests/utils/member-lookup-stand-in';
import { render, screen, within } from '@/tests/utils/render';

import { ActivityLogView } from './activity-log-view';

const SUMMARY = {
  totalActions: 1310,
  successCount: 1200,
  failureCount: 100,
  deniedCount: 10,
  byCategory: { data: 900, security: 410 },
  topActors: [{ actorId: 'user-1', actorEmail: 'ada@example.com', count: 700 }],
};

const EMPTY_SUMMARY = {
  totalActions: 0,
  successCount: 0,
  failureCount: 0,
  deniedCount: 0,
  byCategory: {},
  topActors: [],
};

// The summary read, steered per test; every test starts on the busy week.
const read = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useActivitySummary: () => read.current,
}));
/** The members the lookup knows, and whom the view asked it for. */
const lookup = vi.hoisted(() => ({
  members: [] as StandInMember[],
  asked: [] as MemberLookupTarget[],
}));
vi.mock('@/app/features/settings/organization/hooks/member-lookup', async () =>
  (await import('@/tests/utils/member-lookup-stand-in')).memberLookupStandIn(
    () => lookup.members,
    lookup.asked,
  ),
);
beforeEach(() => {
  lookup.members = [];
  lookup.asked.length = 0;
  read.current = {
    data: SUMMARY,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
});

// 2026-09-26 evaluation, E-03: the tab showed "1,310 actions" without saying
// the totals covered the last 7 days — the period pick sits behind the
// filter button and the default is its resting state.
describe('ActivityLogView', () => {
  it('captions the stat cards with the period they cover, following the filter', async () => {
    const { user } = render(<ActivityLogView organizationId="org-1" />);

    expect(
      screen.getByText(
        'Period: Last 7 days. All totals below cover this period.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('1,310')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /filter/i }));
    if (screen.queryAllByRole('radio').length === 0) {
      await user.click(screen.getByRole('button', { name: /Period/ }));
    }
    await user.click(screen.getByRole('radio', { name: 'Last 30 days' }));

    expect(
      screen.getByText(
        'Period: Last 30 days. All totals below cover this period.',
      ),
    ).toBeInTheDocument();
  });
});

// The period is a widening filter: a longer window holds actions the 7-day
// default leaves out, so an empty week never disables it.
describe('ActivityLogView period filter', () => {
  it('stays usable over a week with no action, and widens the window', async () => {
    read.current = {
      data: EMPTY_SUMMARY,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
    const { user } = render(<ActivityLogView organizationId="org-1" />);

    const filter = screen.getByRole('button', { name: /filter/i });
    expect(filter).toBeEnabled();

    await user.click(filter);
    if (screen.queryAllByRole('radio').length === 0) {
      await user.click(screen.getByRole('button', { name: /Period/ }));
    }
    await user.click(screen.getByRole('radio', { name: 'Last 90 days' }));
    expect(
      screen.getByText(
        'Period: Last 90 days. All totals below cover this period.',
      ),
    ).toBeInTheDocument();
  });

  it('is not disabled while the summary loads', () => {
    read.current = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    };
    const { container } = render(<ActivityLogView organizationId="org-1" />);
    // The loading skeleton masks the whole view — the button sits inert under
    // it, out of the accessibility tree — so it is found by its label; the
    // filter itself must not be disabled on top of that.
    const filter = container.querySelector('button[aria-label="Filter"]');
    expect(filter).not.toBeNull();
    expect(filter).toBeEnabled();
  });
});

function LocaleControls() {
  const { setLocale } = useLocale();
  return (
    <>
      <button onClick={() => setLocale('en')}>English</button>
      <button onClick={() => setLocale('de')}>Deutsch</button>
      <button onClick={() => setLocale('fr')}>Français</button>
    </>
  );
}

describe('ActivityLogView count locales', () => {
  it('updates every count on the mounted view for German, French and English', async () => {
    read.current = {
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      data: {
        totalActions: 5240,
        successCount: 2620,
        failureCount: 1310,
        deniedCount: 1310,
        byCategory: { data: 1310 },
        topActors: [
          { actorId: 'user-1', actorEmail: 'ada@example.com', count: 1310 },
        ],
      },
    };
    const { user } = render(
      <>
        <LocaleControls />
        <ActivityLogView organizationId="org-1" />
      </>,
    );

    for (const [language, total, success, count, categoryTitle, actorTitle] of [
      [
        'Deutsch',
        '5.240',
        '2.620',
        '1.310',
        'Aktivität nach Kategorie',
        'Aktivste Benutzer',
      ],
      [
        'Français',
        '5 240',
        '2 620',
        '1 310',
        'Activité par catégorie',
        'Utilisateurs les plus actifs',
      ],
      [
        'English',
        '5,240',
        '2,620',
        '1,310',
        'Activity by category',
        'Most active users',
      ],
    ]) {
      await user.click(screen.getByRole('button', { name: language }));
      expect(
        screen.getByText(total, { exact: true, normalizer: (text) => text }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(success, { exact: true, normalizer: (text) => text }),
      ).toBeInTheDocument();
      // Both outcome cards and both breakdown surfaces must follow the locale.
      expect(
        screen.getAllByText(count, { exact: true, normalizer: (text) => text }),
      ).toHaveLength(4);
      for (const title of [categoryTitle, actorTitle]) {
        const panel = screen.getByRole('heading', {
          name: title,
        }).parentElement;
        expect(panel).not.toBeNull();
        expect(
          within(panel ?? document.body).getByText(count, {
            exact: true,
            normalizer: (text) => text,
          }),
        ).toBeInTheDocument();
      }
      expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    }
  });
});

it('shows a retry state instead of fabricated zero totals when the summary fails', async () => {
  const refetch = vi.fn();
  read.current = { data: undefined, isLoading: false, isError: true, refetch };
  const { user } = render(<ActivityLogView organizationId="org-1" />);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'Couldn’t load activity summary. Try again.',
  );
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(refetch).toHaveBeenCalledOnce();
});

// The roll-up names an actor by e-mail only when one of their rows recorded
// it; the view looks up the rest instead of reading every member (MEMBER-R11).
it('names a top actor without an e-mail by the one the lookup finds, else by id', () => {
  lookup.members = [{ userId: 'user-2', email: 'noah@example.com' }];
  read.current = {
    data: {
      ...SUMMARY,
      topActors: [
        { actorId: 'user-1', actorEmail: 'ada@example.com', count: 700 },
        { actorId: 'user-2', count: 400 },
        { actorId: 'user-3', count: 200 },
      ],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  render(<ActivityLogView organizationId="org-1" />);
  expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  expect(screen.getByText('noah@example.com')).toBeInTheDocument();
  expect(screen.getByText('user-3')).toBeInTheDocument();
  expect(
    new Set(
      lookup.asked.map((target) =>
        'userId' in target ? target.userId : target.handle,
      ),
    ),
  ).toEqual(new Set(['user-2', 'user-3']));
});
