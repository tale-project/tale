// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { ConvexError } from 'convex/values';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { PromptTemplate, PromptVersionEntry } from '../hooks/queries';

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

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: () => 'April 1, 2026',
  }),
}));

const toastMock = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

function makeEntry(
  version: number,
  overrides: Partial<PromptVersionEntry> = {},
): PromptVersionEntry {
  return {
    version,
    content: `content ${version}`,
    publishedAt: 1_700_000_000_000 + version * 1_000,
    publishedBy: 'user-1',
    publishedByName: 'Alice',
    title: 'Test Prompt',
    scope: 'personal',
    ...overrides,
  };
}

const refetchMock = vi.fn();
const historyData = {
  current: makeEntry(3),
  history: [makeEntry(2), makeEntry(1)],
  totalCount: 3,
};

let mockHistoryResult: {
  data: typeof historyData | null;
  isLoading: boolean;
  isError: boolean;
  refetch: typeof refetchMock;
} = {
  data: historyData,
  isLoading: false,
  isError: false,
  refetch: refetchMock,
};

vi.mock('../hooks/queries', () => ({
  usePromptHistory: () => mockHistoryResult,
  useCategories: () => ({
    data: { personal: [], team: [], global: [] },
    isLoading: false,
  }),
}));

const restoreMock = vi.fn();
vi.mock('../hooks/mutations', () => ({
  useRestorePromptFromVersion: () => ({
    mutateAsync: restoreMock,
    isPending: false,
  }),
}));

import { PromptHistoryDialog } from './prompt-history-dialog';

const basePrompt: PromptTemplate = {
  _id: 'prompt-1' as PromptTemplate['_id'],
  _creationTime: 1700000000000,
  organizationId: 'org-1',
  createdBy: 'user-1',
  title: 'Test Prompt',
  content: 'content 3',
  scope: 'personal',
  usageCount: 0,
  version: 3,
};

afterEach(() => {
  cleanup();
  restoreMock.mockReset();
  restoreMock.mockResolvedValue(undefined);
  refetchMock.mockClear();
  toastMock.mockClear();
  mockHistoryResult = {
    data: historyData,
    isLoading: false,
    isError: false,
    refetch: refetchMock,
  };
});

describe('PromptHistoryDialog', () => {
  it('passes axe audit', async () => {
    const { container } = render(
      <PromptHistoryDialog open onOpenChange={vi.fn()} prompt={basePrompt} />,
    );
    await checkAccessibility(container);
  });

  it('renders one row per version with v-labels', () => {
    render(
      <PromptHistoryDialog open onOpenChange={vi.fn()} prompt={basePrompt} />,
    );
    expect(screen.getByText('v3')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('exposes a listbox with role=option per version', () => {
    render(
      <PromptHistoryDialog open onOpenChange={vi.fn()} prompt={basePrompt} />,
    );
    const listbox = screen.getByRole('listbox', {
      name: /prompts\.history\.versionsLabel/i,
    });
    expect(listbox).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('arrow-key navigation updates aria-activedescendant', () => {
    render(
      <PromptHistoryDialog open onOpenChange={vi.fn()} prompt={basePrompt} />,
    );
    const listbox = screen.getByRole('listbox');
    // initial: first option active
    expect(listbox.getAttribute('aria-activedescendant')).toBe(
      'prompt-version-option-0',
    );
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe(
      'prompt-version-option-1',
    );
    fireEvent.keyDown(listbox, { key: 'End' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe(
      'prompt-version-option-2',
    );
    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe(
      'prompt-version-option-0',
    );
  });

  it('calls restore mutation with targetVersion and expectedVersion', async () => {
    restoreMock.mockResolvedValueOnce(undefined);
    render(
      <PromptHistoryDialog open onOpenChange={vi.fn()} prompt={basePrompt} />,
    );
    const restoreButtons = screen.getAllByText('prompts.history.restore');
    fireEvent.click(restoreButtons[0]);
    const confirmButton = await screen.findByRole('button', {
      name: /prompts\.history\.restore/i,
    });
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(restoreMock).toHaveBeenCalledWith({
        promptId: 'prompt-1',
        targetVersion: 2,
        expectedVersion: 3,
      });
    });
  });

  it('surfaces a restoreStale toast when server throws version_conflict', async () => {
    restoreMock.mockRejectedValueOnce(
      new ConvexError({
        code: 'version_conflict',
        currentVersion: 5,
        expectedVersion: 3,
      }),
    );
    render(
      <PromptHistoryDialog open onOpenChange={vi.fn()} prompt={basePrompt} />,
    );
    fireEvent.click(screen.getAllByText('prompts.history.restore')[0]);
    const confirmButton = await screen.findByRole('button', {
      name: /prompts\.history\.restore/i,
    });
    fireEvent.click(confirmButton);
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'prompts.toast.restoreStale',
          variant: 'destructive',
        }),
      );
    });
  });

  it('renders error state with retry when query fails', () => {
    mockHistoryResult = {
      data: null,
      isLoading: false,
      isError: true,
      refetch: refetchMock,
    };
    render(
      <PromptHistoryDialog open onOpenChange={vi.fn()} prompt={basePrompt} />,
    );
    expect(screen.getByText('prompts.history.loadFailed')).toBeInTheDocument();
    fireEvent.click(screen.getByText('common.retry'));
    expect(refetchMock).toHaveBeenCalled();
  });
});
