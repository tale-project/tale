import '@testing-library/jest-dom/vitest';
import { EditorGroup } from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BackendApiError, backendFetch } from '@/app/lib/backend/api-client';
import { render, screen } from '@/tests/utils/render';

import '@/app/globals.css';

import { ProjectTaskReviewerSection } from './project-task-reviewer-section';

const state = vi.hoisted(() => ({ canEdit: true, failAgents: true }));
vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-browser',
}));
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useProject: () => ({
    project: {
      canEdit: state.canEdit,
      defaultTaskReviewerAgentId: 'agent-1',
      archivedAt: undefined,
    },
  }),
}));
vi.mock('../hooks/mutations', () => ({
  useSetProjectTaskReviewer: () => ({ mutateAsync: vi.fn() }),
}));

const clients: QueryClient[] = [];

function mount() {
  vi.mocked(backendFetch).mockImplementation(async (path) => {
    if (path !== '/projects/project-browser/agents') {
      throw new Error(`Unexpected path: ${path}`);
    }
    if (state.failAgents) throw new BackendApiError(503, 'Controlled');
    return {
      agents: [
        {
          id: 'agent-1',
          name: 'Review agent',
          harness: 'test',
          skills: [],
          connectors: [],
          tools: ['task_review'],
          secrets: [],
          projectId: 'project-browser',
          organizationId: 'org-browser',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 3, retryDelay: 0, gcTime: 0 } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <div style={{ width: 320 }}>
        <EditorGroup>
          <ProjectTaskReviewerSection projectId="project-browser" />
        </EditorGroup>
      </div>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  state.canEdit = true;
  state.failAgents = true;
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

describe(
  'Default reviewer agent reads in Chromium',
  { timeout: 30_000 },
  () => {
    it('keeps the saved agent under the failed list notice and hands the focus to the picker after Try again', async () => {
      const { container, user } = mount();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        "Couldn't load this project's agents.",
      );
      const picker = screen.getByRole('button', { name: 'Default reviewer' });
      expect(picker).toHaveTextContent('Agent not loaded');
      expect(picker).toBeDisabled();
      expect(screen.queryByText(/unavailable/)).not.toBeInTheDocument();
      expectWithin(container);
      await expectAccessible(container);
      state.failAgents = false;
      await user.tab();
      const retry = screen.getByRole('button', { name: 'Try again' });
      expect(retry).toHaveFocus();
      await user.keyboard('{Enter}');
      await waitFor(() => expect(picker).toHaveTextContent('Review agent'));
      await waitFor(() => expect(picker).toHaveFocus());
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('hands the focus to the field when a reader reads the list again', async () => {
      state.canEdit = false;
      const { user } = mount();
      await screen.findByRole('alert');
      state.failAgents = false;
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      const picker = screen.getByRole('button', { name: 'Default reviewer' });
      await waitFor(() => expect(picker).toHaveTextContent('Review agent'));
      await waitFor(() =>
        expect(
          screen.getByRole('group', { name: 'Default reviewer' }),
        ).toHaveFocus(),
      );
    });
  },
);
