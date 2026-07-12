import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// The Knowledge tab is a preview over three data sources: the agent binding
// (its team set + attached files), the org document list, and the draft
// config. Mock exactly those; the list/empty-state rendering under test stays
// real. `mock`-prefixed fns so Vitest hoisting lets the factories reference
// them and individual tests reshape the data.
const mockBinding = vi.fn((): { data: unknown } => ({ data: undefined }));
vi.mock('../hooks/queries', () => ({
  useAgentBinding: () => mockBinding(),
}));

const mockDocuments = vi.fn(
  (
    _organizationId: string,
    _options?: { enabled?: boolean },
  ): { documents: unknown[] | undefined; isLoading: boolean } => ({
    documents: [],
    isLoading: false,
  }),
);
vi.mock('@/app/features/documents/hooks/queries', () => ({
  useDocuments: (organizationId: string, options?: { enabled?: boolean }) =>
    mockDocuments(organizationId, options),
}));

const mockConfig = vi.fn((): Record<string, unknown> => ({}));
vi.mock('../hooks/use-agent-config-context', () => ({
  useAgentConfig: () => ({ config: mockConfig(), updateConfig: vi.fn() }),
}));

vi.mock('../hooks/use-agent-file-upload', () => ({
  useAgentFileUpload: () => ({
    uploadFiles: vi.fn(),
    isUploading: false,
    accept: '.pdf',
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useRemoveKnowledgeFile: () => ({ mutateAsync: vi.fn() }),
}));

// The badge subscribes to per-document RAG state — irrelevant to the
// list-membership behaviour under test.
vi.mock('@/app/features/documents/components/rag-status-badge', () => ({
  RagStatusBadge: () => null,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { AgentKnowledge } from './agent-knowledge';

// Resolved from messages/en.json — settings.agents.knowledge.*.
const TEAM_EMPTY_STATE = 'No documents found for this team.';
const TEAM_SECTION = 'Team documents';

const TEAM_DOC = { id: 'd1', name: 'Team handbook', teamId: 'team-1' };
const SHARED_TEAM_DOC = { id: 'd2', name: 'Shared roadmap', teamId: 'team-2' };
const OTHER_TEAM_DOC = { id: 'd3', name: 'Other team notes', teamId: 'team-3' };
const ORG_DOC = { id: 'd4', name: 'Org policy' };

function renderKnowledge() {
  return render(<AgentKnowledge organizationId="org-1" agentId="my-agent" />);
}

describe('AgentKnowledge team documents preview (#2666)', () => {
  it('lists the docs of the owning + shared teams and omits other teams’ and org docs', () => {
    // Mirrors the runtime (`getAgentTeamIds` → `get_agent_scoped_file_ids`):
    // owning team + sharedWithTeamIds count, other teams and org-level don't.
    mockConfig.mockReturnValue({ knowledgeMode: 'tool' });
    mockBinding.mockReturnValue({
      data: { teamId: 'team-1', sharedWithTeamIds: ['team-2'] },
    });
    mockDocuments.mockReturnValue({
      documents: [TEAM_DOC, SHARED_TEAM_DOC, OTHER_TEAM_DOC, ORG_DOC],
      isLoading: false,
    });

    renderKnowledge();

    expect(screen.getByText(TEAM_SECTION)).toBeInTheDocument();
    expect(screen.getByText('Team handbook')).toBeInTheDocument();
    expect(screen.getByText('Shared roadmap')).toBeInTheDocument();
    expect(screen.queryByText('Other team notes')).not.toBeInTheDocument();
    expect(screen.queryByText('Org policy')).not.toBeInTheDocument();
    // The pre-fix bug: this empty state rendered even when team docs exist.
    expect(screen.queryByText(TEAM_EMPTY_STATE)).not.toBeInTheDocument();
  });

  it('shows the team empty state only when the team set truly has no docs', () => {
    mockConfig.mockReturnValue({ knowledgeMode: 'tool' });
    mockBinding.mockReturnValue({
      data: { teamId: 'team-1', sharedWithTeamIds: [] },
    });
    mockDocuments.mockReturnValue({
      documents: [OTHER_TEAM_DOC, ORG_DOC],
      isLoading: false,
    });

    renderKnowledge();

    expect(screen.getByText(TEAM_EMPTY_STATE)).toBeInTheDocument();
    expect(screen.queryByText(TEAM_SECTION)).not.toBeInTheDocument();
  });

  it('does not claim an empty team while the document list is still loading', () => {
    mockConfig.mockReturnValue({ knowledgeMode: 'tool' });
    mockBinding.mockReturnValue({
      data: { teamId: 'team-1', sharedWithTeamIds: [] },
    });
    mockDocuments.mockReturnValue({ documents: undefined, isLoading: true });

    renderKnowledge();

    expect(screen.queryByText(TEAM_EMPTY_STATE)).not.toBeInTheDocument();
  });

  it('skips the document query for a teamless agent with org knowledge off', () => {
    // A no-team agent gets no team docs at runtime either — the truthful
    // empty state renders without pulling the whole document collection.
    mockConfig.mockReturnValue({ knowledgeMode: 'tool' });
    mockBinding.mockReturnValue({ data: { teamId: null } });
    mockDocuments.mockReturnValue({ documents: [], isLoading: false });

    renderKnowledge();

    expect(mockDocuments).toHaveBeenCalledWith('org-1', { enabled: false });
    expect(screen.getByText(TEAM_EMPTY_STATE)).toBeInTheDocument();
  });
});
