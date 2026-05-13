// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import type { PromptTemplate } from '../../hooks/queries';

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

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const refetchMock = vi.fn();
const historyData = {
  current: {
    version: 3,
    content: 'current content',
    publishedAt: 1700000300000,
    publishedBy: 'user-1',
    publishedByName: 'Alice',
  },
  history: [
    {
      version: 2,
      content: 'second content',
      publishedAt: 1700000200000,
      publishedBy: 'user-1',
      publishedByName: 'Alice',
    },
    {
      version: 1,
      content: 'first content',
      publishedAt: 1700000100000,
      publishedBy: 'user-1',
      publishedByName: 'Alice',
    },
  ],
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

vi.mock('../../hooks/queries', () => ({
  usePromptHistory: () => mockHistoryResult,
}));

const restoreMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../../hooks/mutations', () => ({
  useRestorePromptFromVersion: () => ({
    mutateAsync: restoreMock,
    isPending: false,
  }),
}));

import { PromptHistoryDialog } from '../prompt-history-dialog';

const basePrompt: PromptTemplate = {
  _id: 'prompt-1' as PromptTemplate['_id'],
  _creationTime: 1700000000000,
  organizationId: 'org-1',
  createdBy: 'user-1',
  title: 'Test Prompt',
  content: 'current content',
  scope: 'personal',
  usageCount: 0,
  version: 3,
};

afterEach(() => {
  cleanup();
  restoreMock.mockClear();
  refetchMock.mockClear();
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

  it('calls restore mutation with targetVersion on confirm', async () => {
    render(
      <PromptHistoryDialog open onOpenChange={vi.fn()} prompt={basePrompt} />,
    );
    // Each non-current row has a Restore button. Click the v2 row's Restore
    // (there are two Restore buttons total — one per non-current row, plus
    // the confirm-dialog button after we open it).
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
    fireEvent.click(screen.getByText('prompts.history.retry'));
    expect(refetchMock).toHaveBeenCalled();
  });
});
