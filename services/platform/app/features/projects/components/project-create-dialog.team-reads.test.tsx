import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import { forgetSavedLocale } from '@/tests/utils/lapsed-session';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { ProjectCreateDialog } from './project-create-dialog';

// "Who can see it" lists the teams the creator may assign, and an empty
// choice creates the project organization-wide. Until that read has
// answered, the creator has not seen the choice: Create must wait, and a
// failed read is named with Try again, never treated as "no teams" (#4836).

const { createProject, navigate } = vi.hoisted(() => ({
  createProject: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-audit',
}));
vi.mock('../hooks/mutations', () => ({
  useCreateProject: () => ({ mutateAsync: createProject }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
}));
vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

const team = { id: 'a', name: 'Alpha', memberCount: 1, createdAt: 0 };
const clients: QueryClient[] = [];
type Answer = () => Promise<unknown>;
const failed = () => Promise.reject(new BackendApiError(503, 'Controlled'));
const answered = () => Promise.resolve({ teams: [team] });
/** A creator who may assign no team: organization-wide is the only choice. */
const none = () => Promise.resolve({ teams: [] });
const held = () => {
  let release: () => void = () => {};
  const answer: Answer = () =>
    new Promise((resolve) => {
      release = () => resolve({ teams: [team] });
    });
  return { answer, release: () => release() };
};

/** The one read the dialog makes: the assignable teams (`GET /teams`). */
function serve(teams: Answer) {
  const counts = { teams: 0 };
  vi.mocked(backendFetch).mockImplementation(async (path) => {
    if (path === '/teams') {
      counts.teams += 1;
      return teams();
    }
    throw new Error(`Unexpected path: ${path}`);
  });
  return counts;
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0, gcTime: 0 } },
  });
  clients.push(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ProjectCreateDialog
          open
          onOpenChange={vi.fn()}
          organizationId="org-audit"
          navigateOnCreate={false}
        />
      </QueryClientProvider>,
    ),
  };
}

/** The dialog's form, submitted the way Enter in a field would. */
function submitForm() {
  const form = screen
    .getByRole('textbox', { name: 'Project name' })
    .closest('form');
  if (form === null) throw new Error('The dialog has no form');
  fireEvent.submit(form);
}

afterEach(async () => {
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.clearAllMocks();
  localStorage.removeItem('user-locale');
  await i18n.changeLanguage('en');
  await forgetSavedLocale();
});

describe('New project audience team read', { timeout: 30_000 }, () => {
  it('creates nothing when the teams read fails, names the failure and reads again on Try again', async () => {
    createProject.mockResolvedValue('proj-1');
    const counts = serve(failed);
    const { user } = mount();
    await waitFor(() => expect(counts.teams).toBe(4));
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    const submit = screen.getByRole('button', { name: 'Create project' });
    await user.type(
      screen.getByRole('textbox', { name: 'Project name' }),
      'Launch',
    );
    await user.click(submit);
    submitForm();
    await act(async () => {});
    expect(createProject).not.toHaveBeenCalled();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Couldn't load teams.",
    );
    expect(within(dialog).getByText('Who can see it')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
    await checkAccessibility(dialog);

    const next = held();
    const again = serve(next.answer);
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(submit).toBeDisabled();
    await act(async () => next.release());
    const audience = await screen.findByRole('combobox', {
      name: 'Who can see it',
    });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(audience).toHaveFocus());
    expect(again.teams).toBe(1);
    expect(submit).toBeEnabled();
    expect(createProject).not.toHaveBeenCalled();
  });

  it('holds Create while the teams read is pending, then offers the field', async () => {
    const teams = held();
    serve(teams.answer);
    const { user } = mount();
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    const submit = screen.getByRole('button', { name: 'Create project' });
    await user.type(
      screen.getByRole('textbox', { name: 'Project name' }),
      'Launch',
    );
    expect(within(dialog).getByRole('status')).toBeInTheDocument();
    expect(within(dialog).getByText('Who can see it')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
    submitForm();
    await act(async () => {});
    expect(createProject).not.toHaveBeenCalled();

    await act(async () => teams.release());
    expect(
      await screen.findByRole('combobox', { name: 'Who can see it' }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    expect(submit).toBeEnabled();
  });

  it('sends the teams the creator picks once the read answers', async () => {
    createProject.mockResolvedValue('proj-1');
    serve(answered);
    const { user } = mount();
    await user.type(
      screen.getByRole('textbox', { name: 'Project name' }),
      'Launch',
    );
    await user.click(
      await screen.findByRole('combobox', { name: 'Who can see it' }),
    );
    await user.click(await screen.findByRole('option', { name: 'Alpha' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Launch', teamIds: ['a'] }),
    );
  });

  it('holds Create when a refresh of the teams fails, and keeps the pick for the read that answers', async () => {
    createProject.mockResolvedValue('proj-1');
    let answer: Answer = answered;
    serve(() => answer());
    const { client, user } = mount();
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    const submit = screen.getByRole('button', { name: 'Create project' });
    await user.type(
      screen.getByRole('textbox', { name: 'Project name' }),
      'Launch',
    );
    await user.click(
      await screen.findByRole('combobox', { name: 'Who can see it' }),
    );
    await user.click(await screen.findByRole('option', { name: 'Alpha' }));
    await user.keyboard('{Escape}');

    answer = failed;
    await act(async () => {
      await client.refetchQueries();
    });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "Couldn't load teams.",
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
    submitForm();
    await act(async () => {});
    expect(createProject).not.toHaveBeenCalled();

    answer = answered;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('combobox', { name: 'Who can see it' });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Launch', teamIds: ['a'] }),
    );
  });

  it('creates organization-wide without the field when the creator may assign no team', async () => {
    createProject.mockResolvedValue('proj-1');
    serve(none);
    const { user } = mount();
    const dialog = screen.getByRole('dialog', { name: 'Create project' });
    const submit = screen.getByRole('button', { name: 'Create project' });
    await user.type(
      screen.getByRole('textbox', { name: 'Project name' }),
      'Launch',
    );
    await waitFor(() => expect(submit).toBeEnabled());
    expect(
      within(dialog).queryByText('Who can see it'),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    await user.click(submit);
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(createProject.mock.calls[0]?.[0]).not.toHaveProperty('teamIds');
  });

  it.each([
    {
      locale: 'en',
      message: "Couldn't load teams.",
      retry: 'Try again',
      create: 'Create project',
    },
    {
      locale: 'de',
      message: 'Teams konnten nicht geladen werden.',
      retry: 'Erneut versuchen',
      create: 'Projekt erstellen',
    },
    {
      locale: 'fr',
      message: 'Impossible de charger les équipes.',
      retry: 'Réessayer',
      create: 'Créer le projet',
    },
    {
      locale: 'de-CH',
      message: 'Teams konnten nicht geladen werden.',
      retry: 'Erneut versuchen',
      create: 'Projekt erstellen',
    },
  ])(
    'names a failed teams read in $locale',
    async ({ locale, message, retry, create }) => {
      localStorage.setItem('user-locale', locale);
      await i18n.changeLanguage(locale);
      serve(failed);
      mount();
      expect(await screen.findByRole('alert')).toHaveTextContent(message);
      expect(screen.getByRole('button', { name: retry })).toBeEnabled();
      expect(screen.getByRole('button', { name: create })).toBeDisabled();
    },
  );
});
