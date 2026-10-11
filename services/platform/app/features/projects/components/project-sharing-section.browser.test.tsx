import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
import { act, render, screen } from '@/tests/utils/render';

import '@/app/globals.css';

import { ProjectSharingSection } from './project-sharing-section';

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-browser',
}));
vi.mock('../hooks/mutations', () => ({
  useUpdateProjectSharing: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/teams">{children}</a>
  ),
}));

const alpha = { id: 'a', name: 'Alpha', memberCount: 1, createdAt: 0 };
const beta = { id: 'b', name: 'Beta', memberCount: 1, createdAt: 0 };
const clients: QueryClient[] = [];
let failTeams = true;
let failDirectory = false;

function mount(canAdminister: boolean) {
  vi.mocked(backendFetch).mockImplementation(async (path) => {
    if (path === '/teams/directory') {
      if (failDirectory) throw new BackendApiError(503, 'Controlled');
      return { teams: [alpha, beta] };
    }
    if (path === '/teams') {
      if (failTeams) throw new BackendApiError(503, 'Controlled');
      return { teams: canAdminister ? [alpha, beta] : [] };
    }
    throw new Error(`Unexpected path: ${path}`);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0, gcTime: 0 } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <div style={{ width: 320 }}>
        <ProjectSharingSection
          projectId="project-browser"
          organizationId="org-browser"
          teamIds={['a', 'b']}
          canAdminister={canAdminister}
        />
      </div>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  failTeams = true;
  failDirectory = false;
  vi.clearAllMocks();
});

/** WCAG 2.1 A/AA in the real renderer, with measured contrast in both themes.
 * Transitions are off while it measures: a colour still easing to the new
 * theme would be read half-way. */
async function expectAccessible(container: HTMLElement) {
  const still = document.createElement('style');
  still.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(still);
  for (const theme of ['light', 'dark']) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const result = await axe.run(container, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    });
    expect(result.violations).toEqual([]);
    expect(result.passes.some((rule) => rule.id === 'color-contrast')).toBe(
      true,
    );
  }
  document.documentElement.classList.remove('dark');
  still.remove();
}

/** Every box inside the 320px column stays inside it: no clipped notice. */
function expectWithin(container: HTMLElement) {
  const frame = container.firstElementChild?.getBoundingClientRect();
  if (frame === undefined) throw new Error('Expected a frame');
  for (const element of container.querySelectorAll('[role="alert"] *')) {
    const box = element.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(frame.right + 0.5);
  }
}

describe('Audience team reads in Chromium', { timeout: 30_000 }, () => {
  it('keeps the failed teams notice inside a narrow column and hands focus to the picker after Try again', async () => {
    const { container, user } = mount(true);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load teams.",
    );
    expect(screen.getByText('Alpha, Beta')).toBeVisible();
    expectWithin(container);
    await expectAccessible(container);
    failTeams = false;
    await user.tab();
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(retry).toHaveFocus();
    await user.keyboard('{Enter}');
    const picker = await screen.findByRole('combobox', { name: 'Audience' });
    await waitFor(() => expect(picker).toHaveFocus());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("counts a member's audience when names fail and returns focus to the row after Try again", async () => {
    failTeams = false;
    failDirectory = true;
    const { container, user } = mount(false);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't load team names.",
    );
    const group = screen.getByRole('group', { name: 'Effective audience' });
    expect(group).toHaveTextContent('2 teams');
    expect(screen.queryByText(/Unknown team/)).not.toBeInTheDocument();
    expectWithin(container);
    await expectAccessible(container);
    failDirectory = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await act(async () => {});
    await waitFor(() => expect(group).toHaveTextContent('Alpha, Beta'));
    await waitFor(() => expect(group).toHaveFocus());
  });
});
