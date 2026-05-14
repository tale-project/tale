// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { fireEvent, render, screen } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'user-1' } }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { role: 'admin' } }),
}));

// Mutable mock so individual tests can override the usePrompts result.
const defaultPrompt = {
  _id: 'prompt-1',
  _creationTime: 1700000000000,
  organizationId: 'test-org-id',
  createdBy: 'user-1',
  title: 'Test Prompt',
  content: 'Hello {{name}}, how can I help?',
  description: 'A test prompt',
  scope: 'personal',
  category: 'testing',
  tags: ['test'],
  usageCount: 5,
};

const mockLoadMore = vi.fn();
let mockUsePromptsResult: {
  prompts: unknown[];
  isLoading: boolean;
  canLoadMore: boolean;
  isLoadingMore: boolean;
  loadMore: typeof mockLoadMore;
} = {
  prompts: [defaultPrompt],
  isLoading: false,
  canLoadMore: false,
  isLoadingMore: false,
  loadMore: mockLoadMore,
};

vi.mock('../../hooks/queries', () => ({
  usePrompts: () => mockUsePromptsResult,
  usePrompt: () => ({ data: null, isLoading: false }),
  usePromptHistory: () => ({ data: null, isLoading: false }),
  usePromptFacets: () => ({
    data: {
      categories: ['testing'],
      tags: ['test'],
      scanned: 1,
      scanCapped: false,
    },
    isLoading: false,
  }),
}));

vi.mock('../../hooks/mutations', () => ({
  useCreatePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useIncrementPromptUsage: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRestorePromptFromVersion: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

import { PromptLibraryDialog } from '../prompt-library-dialog';

describe('PromptLibraryDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <PromptLibraryDialog
          open={true}
          onOpenChange={vi.fn()}
          onSelectPrompt={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  it('renders prompt cards when open', () => {
    render(
      <PromptLibraryDialog
        open={true}
        onOpenChange={vi.fn()}
        onSelectPrompt={vi.fn()}
      />,
    );
    expect(screen.getByText('Test Prompt')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <PromptLibraryDialog
        open={false}
        onOpenChange={vi.fn()}
        onSelectPrompt={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  describe('pagination + empty + loading states', () => {
    it('Load more button click calls loadMore', () => {
      mockUsePromptsResult = {
        prompts: [defaultPrompt],
        isLoading: false,
        canLoadMore: true,
        isLoadingMore: false,
        loadMore: mockLoadMore,
      };
      render(
        <PromptLibraryDialog
          open={true}
          onOpenChange={vi.fn()}
          onSelectPrompt={vi.fn()}
        />,
      );
      const loadMoreBtn = screen.getByRole('button', {
        name: 'prompts.library.loadMore',
      });
      fireEvent.click(loadMoreBtn);
      expect(mockLoadMore).toHaveBeenCalled();
    });

    it('renders the empty state when no prompts and no filters', () => {
      mockUsePromptsResult = {
        prompts: [],
        isLoading: false,
        canLoadMore: false,
        isLoadingMore: false,
        loadMore: mockLoadMore,
      };
      render(
        <PromptLibraryDialog
          open={true}
          onOpenChange={vi.fn()}
          onSelectPrompt={vi.fn()}
        />,
      );
      expect(screen.getByText('prompts.emptyState.title')).toBeInTheDocument();
    });

    it('renders the loading skeleton when isLoading and no prompts', () => {
      mockUsePromptsResult = {
        prompts: [],
        isLoading: true,
        canLoadMore: false,
        isLoadingMore: false,
        loadMore: mockLoadMore,
      };
      render(
        <PromptLibraryDialog
          open={true}
          onOpenChange={vi.fn()}
          onSelectPrompt={vi.fn()}
        />,
      );
      // Skeleton rows use `animate-pulse`; Radix portals into document.body,
      // so query there rather than the render container.
      expect(document.body.querySelector('.animate-pulse')).not.toBeNull();
    });
  });
});

beforeEach(() => {
  mockLoadMore.mockReset();
  mockUsePromptsResult = {
    prompts: [defaultPrompt],
    isLoading: false,
    canLoadMore: false,
    isLoadingMore: false,
    loadMore: mockLoadMore,
  };
});

afterEach(() => {
  mockUsePromptsResult = {
    prompts: [defaultPrompt],
    isLoading: false,
    canLoadMore: false,
    isLoadingMore: false,
    loadMore: mockLoadMore,
  };
});
