import { EditorGroup } from '@tale/ui/editor';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { configure, render, screen, waitFor } from '@/tests/utils/render';
import {
  serviceUnavailable,
  syntheticBackend,
  type SyntheticBackend,
} from '@/tests/utils/synthetic-backend';

import { ProjectTaskReviewerSection } from './project-task-reviewer-section';

configure({ asyncUtilTimeout: 10_000 });
const state = vi.hoisted(() => ({
  project: {
    canEdit: true,
    defaultTaskReviewerAgentId: 'agent-1' as string | undefined,
    archivedAt: undefined as number | undefined,
  },
  save: vi.fn(),
}));
vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/queries')>()),
  useProject: () => ({ project: state.project }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));
vi.mock('../hooks/mutations', () => ({
  useSetProjectTaskReviewer: () => ({ mutateAsync: state.save }),
}));

const AGENTS = /^GET \/api\/app\/projects\/proj-1\/agents\?orgId=org-1$/;
const COPY = {
  en: {
    field: 'Default reviewer',
    loadFailed: "Couldn't load this project's agents.",
    notLoaded: 'Agent not loaded',
    retry: 'Try again',
  },
  de: {
    field: 'Standard-Reviewer',
    loadFailed: 'Die Agenten dieses Projekts konnten nicht geladen werden.',
    notLoaded: 'Agent nicht geladen',
    retry: 'Erneut versuchen',
  },
  fr: {
    field: 'Relecteur par défaut',
    loadFailed: 'Impossible de charger les agents de ce projet.',
    notLoaded: 'Agent non chargé',
    retry: 'Réessayer',
  },
};
const UNAVAILABLE =
  /The selected reviewer agent is unavailable|Der gewählte Reviewer-Agent ist nicht verfügbar|L’agent relecteur sélectionné est indisponible/;
let backend: SyntheticBackend;
let client: QueryClient;

function listed(...names: string[]) {
  return () =>
    Response.json({
      agents: names.map((name, index) => ({
        id: `agent-${index + 1}`,
        name,
        harness: 'test',
        skills: [],
        connectors: [],
        tools: ['task_review'],
        secrets: [],
        projectId: 'proj-1',
        organizationId: 'org-1',
        createdAt: 1,
        updatedAt: 1,
      })),
    });
}

beforeEach(() => {
  state.project = {
    canEdit: true,
    defaultTaskReviewerAgentId: 'agent-1',
    archivedAt: undefined,
  };
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/projects/proj-1/overview',
  );
  backend = syntheticBackend();
  client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, gcTime: Infinity } },
  });
});
afterEach(async () => {
  client.clear();
  vi.restoreAllMocks();
  await forgetSavedLocale();
});
function renderSection() {
  return render(
    <QueryClientProvider client={client}>
      <EditorGroup>
        <ProjectTaskReviewerSection projectId="proj-1" />
      </EditorGroup>
    </QueryClientProvider>,
  );
}

describe(
  'Default reviewer when the agent list fails to load',
  { timeout: 30_000 },
  () => {
    it.each(SHIPPED_LOCALES)(
      'keeps the saved agent and names the failure in %s',
      async (locale) => {
        saveLocale(locale);
        backend.on(AGENTS, serviceUnavailable);
        const { container } = renderSection();
        expect(await screen.findByRole('alert')).toHaveTextContent(
          COPY[locale].loadFailed,
        );
        // The read policy's attempts, then the failure: no verdict on the
        // agent, and no choice offered from a list that never answered.
        expect(backend.count(AGENTS)).toBe(4);
        const picker = screen.getByRole('button', { name: COPY[locale].field });
        expect(picker).toHaveTextContent(COPY[locale].notLoaded);
        expect(picker).toBeDisabled();
        expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: COPY[locale].retry }),
        ).toBeEnabled();
        await checkAccessibility(container);
      },
    );

    it('reads the list again on Try again and hands the focus to the picker', async () => {
      backend.on(AGENTS, serviceUnavailable);
      const { user } = renderSection();
      await screen.findByRole('alert');
      backend.on(AGENTS, listed('Review agent'));
      screen.getByRole('button', { name: 'Try again' }).focus();
      await user.keyboard('{Enter}');
      const picker = screen.getByRole('button', { name: 'Default reviewer' });
      await waitFor(() => expect(picker).toHaveTextContent('Review agent'));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(picker).toBeEnabled();
      await waitFor(() => expect(picker).toHaveFocus());
      expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
      expect(state.save).not.toHaveBeenCalled();
    });

    it('hands the focus to the field when the picker stays read-only', async () => {
      state.project = { ...state.project, canEdit: false };
      backend.on(AGENTS, serviceUnavailable);
      const { user } = renderSection();
      await screen.findByRole('alert');
      backend.on(AGENTS, listed('Review agent'));
      screen.getByRole('button', { name: 'Try again' }).focus();
      await user.keyboard('{Enter}');
      const picker = screen.getByRole('button', { name: 'Default reviewer' });
      await waitFor(() => expect(picker).toHaveTextContent('Review agent'));
      expect(picker).toBeDisabled();
      await waitFor(() =>
        expect(
          screen.getByRole('group', { name: 'Default reviewer' }),
        ).toHaveFocus(),
      );
    });

    it('still says a removed agent is unavailable once the list answers', async () => {
      backend.on(AGENTS, listed());
      renderSection();
      // The value and the caption under it.
      await waitFor(() =>
        expect(screen.getAllByText(UNAVAILABLE)).toHaveLength(2),
      );
      expect(
        screen.getByRole('button', { name: 'Default reviewer' }),
      ).toHaveTextContent(UNAVAILABLE);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(backend.count(AGENTS)).toBe(1);
    });
  },
);
