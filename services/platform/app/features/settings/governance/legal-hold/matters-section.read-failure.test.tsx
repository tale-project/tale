import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import type { useLegalMatters } from '../hooks/queries';
import { MattersSection } from './matters-section';

type MatterRow = NonNullable<
  ReturnType<typeof useLegalMatters>['data']
>[number];

// The matters read as react-query reports it; each test sets how it stands.
const { matters } = vi.hoisted(() => ({
  matters: {
    data: undefined as MatterRow[] | undefined,
    isLoading: false,
    isError: true,
    isFetching: false,
    errorUpdateCount: 1,
    error: new Error('Matters unavailable') as Error | null,
    refetch: vi.fn(),
  },
}));

vi.mock('../hooks/queries', () => ({
  useLegalMatters: () => matters,
}));
// The dialogs stay closed here; their writes are not under test.
vi.mock('./upsert-matter-dialog', () => ({ UpsertMatterDialog: () => null }));
vi.mock('./close-matter-dialog', () => ({ CloseMatterDialog: () => null }));
// DataTable reads the org id from the router, which has no provider in jsdom.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function matter(id: string, name: string): MatterRow {
  return {
    _id: id,
    organizationId: 'org-1',
    name,
    caseNumber: `CASE-${id}`,
    status: 'open',
    createdBy: 'user-1',
    createdByName: 'Alice',
    createdAt: Date.UTC(2026, 9, 1, 10),
    linkedActiveHolds: 2,
  };
}

function failed(errorUpdateCount = 1) {
  matters.isError = true;
  matters.isLoading = false;
  matters.isFetching = false;
  matters.errorUpdateCount = errorUpdateCount;
  matters.error = new Error('Matters unavailable');
}

function answered(rows: MatterRow[]) {
  matters.data = rows;
  matters.isError = false;
  matters.isLoading = false;
  matters.isFetching = false;
  matters.error = null;
}

const section = () => <MattersSection organizationId="org-1" />;

beforeEach(() => {
  vi.clearAllMocks();
  matters.data = undefined;
  failed();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem('user-locale');
});

describe('MattersSection read failure (#3837)', () => {
  it.each([
    ['en-US', "Couldn't load the matters.", 'Try again', 'No matters'],
    [
      'de-DE',
      'Die Fälle konnten nicht geladen werden.',
      'Erneut versuchen',
      'Keine Fälle',
    ],
    [
      'fr-FR',
      'Impossible de charger les dossiers.',
      'Réessayer',
      'Aucun dossier',
    ],
  ])(
    'names a failed read in %s instead of an empty register',
    async (locale, message, retryText, emptyTitle) => {
      localStorage.setItem('user-locale', locale);
      render(section());
      const alert = (await screen.findByText(message)).closest(
        '[role="alert"]',
      );
      expect(alert).not.toBeNull();
      expect(
        within(alert as HTMLElement).getByRole('button', { name: retryText }),
      ).toBeInTheDocument();
      expect(screen.queryByText(emptyTitle)).not.toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    },
  );

  it('retries the read from Try again', async () => {
    const { user } = render(section());
    const alert = screen.getByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(matters.refetch).toHaveBeenCalledTimes(1);
    await checkAccessibility(document.body);
  });

  it('keeps Try again focused and busy through the retry, then hands the focus to the section', async () => {
    const { user, rerender } = render(section());
    const retry = within(screen.getByRole('alert')).getByRole('button', {
      name: 'Try again',
    });
    await user.click(retry);
    expect(retry).toHaveFocus();
    // react-query restarts a read that never answered from `pending`, with
    // no error, for the length of the retry.
    matters.isError = false;
    matters.error = null;
    matters.isLoading = true;
    matters.isFetching = true;
    rerender(section());
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByText('No matters')).not.toBeInTheDocument();
    await user.click(retry);
    expect(matters.refetch).toHaveBeenCalledTimes(1);

    failed(2);
    rerender(section());
    expect(retry).toHaveFocus();
    expect(retry).not.toHaveAttribute('aria-busy');

    answered([matter('m1', 'Acme v. Globex')]);
    rerender(section());
    expect(await screen.findByText('Acme v. Globex')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Matters' })).toHaveFocus(),
    );
  });

  it('keeps the rows a failed refresh leaves and names the refresh failure', async () => {
    answered([matter('m1', 'Acme v. Globex'), matter('m2', 'Initech audit')]);
    failed();
    const { user } = render(section());
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      "Couldn't load the latest matters. What's listed may be out of date.",
    );
    expect(screen.getByText('Acme v. Globex')).toBeInTheDocument();
    expect(screen.getByText('Initech audit')).toBeInTheDocument();
    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(matters.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the empty state for a register that answered with no matters', () => {
    answered([]);
    matters.errorUpdateCount = 0;
    render(section());
    expect(screen.getByText('No matters')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lists the matters of a register that answered', () => {
    answered([matter('m1', 'Acme v. Globex'), matter('m2', 'Initech audit')]);
    matters.errorUpdateCount = 0;
    render(section());
    expect(screen.getByText('Acme v. Globex')).toBeInTheDocument();
    expect(screen.getByText('Initech audit')).toBeInTheDocument();
    expect(screen.queryByText('No matters')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not show an empty register while the first read is loading', () => {
    matters.isError = false;
    matters.error = null;
    matters.isLoading = true;
    matters.isFetching = true;
    matters.errorUpdateCount = 0;
    render(section());
    expect(screen.queryByText('No matters')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
