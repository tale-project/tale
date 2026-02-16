import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SyncStatusIndicator } from '../sync-status-indicator';

// Mock i18n (unused directly but Tooltip may use it)
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

// Mock sync status
const mockSyncNow = vi.fn().mockResolvedValue(undefined);
let mockSyncStatus = {
  isOnline: true,
  isOffline: false,
  isSyncing: false,
  pendingMutations: 0,
  failedMutations: 0,
  lastSyncAttempt: null as number | null,
  lastSuccessfulSync: null as number | null,
  hasPendingChanges: false,
  syncNow: mockSyncNow,
};
vi.mock('@/app/hooks/use-sync-status', () => ({
  useSyncStatus: () => mockSyncStatus,
}));

// Mock mutation queue
const mockRetryAll = vi.fn().mockResolvedValue(0);
let mockMutationQueue = {
  pendingCount: 0,
  failedCount: 0,
  hasPending: false,
  hasFailed: false,
  getPending: vi.fn(),
  getFailed: vi.fn(),
  retry: vi.fn(),
  retryAll: mockRetryAll,
  clearAll: vi.fn(),
  refreshStats: vi.fn(),
};
vi.mock('@/app/hooks/use-mutation-queue', () => ({
  useMutationQueue: () => mockMutationQueue,
}));

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  mockSyncStatus = {
    isOnline: true,
    isOffline: false,
    isSyncing: false,
    pendingMutations: 0,
    failedMutations: 0,
    lastSyncAttempt: null,
    lastSuccessfulSync: null,
    hasPendingChanges: false,
    syncNow: mockSyncNow,
  };
  mockMutationQueue = {
    pendingCount: 0,
    failedCount: 0,
    hasPending: false,
    hasFailed: false,
    getPending: vi.fn(),
    getFailed: vi.fn(),
    retry: vi.fn(),
    retryAll: mockRetryAll,
    clearAll: vi.fn(),
    refreshStats: vi.fn(),
  };
});

describe('SyncStatusIndicator', () => {
  it('renders synced state by default', () => {
    render(<SyncStatusIndicator />);
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it('shows label when showLabel is true', () => {
    render(<SyncStatusIndicator showLabel />);
    expect(screen.getByText('Synced')).toBeInTheDocument();
  });

  it('shows offline state', () => {
    mockSyncStatus = { ...mockSyncStatus, isOnline: false, isOffline: true };
    render(<SyncStatusIndicator showLabel />);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows syncing state', () => {
    mockSyncStatus = { ...mockSyncStatus, isSyncing: true };
    render(<SyncStatusIndicator showLabel />);
    expect(screen.getByText('Syncing...')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows failed count and label', () => {
    mockMutationQueue = {
      ...mockMutationQueue,
      failedCount: 3,
      hasFailed: true,
    };
    render(<SyncStatusIndicator showLabel />);
    expect(screen.getByText('3 failed')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows pending count and label', () => {
    mockMutationQueue = {
      ...mockMutationQueue,
      pendingCount: 5,
      hasPending: true,
    };
    render(<SyncStatusIndicator showLabel />);
    expect(screen.getByText('5 pending')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls syncNow on click when synced', async () => {
    const user = userEvent.setup();
    render(<SyncStatusIndicator />);

    await user.click(screen.getByRole('button'));
    expect(mockSyncNow).toHaveBeenCalled();
  });

  it('calls retryAll then syncNow on click when there are failures', async () => {
    const user = userEvent.setup();
    mockMutationQueue = {
      ...mockMutationQueue,
      failedCount: 2,
      hasFailed: true,
    };

    render(<SyncStatusIndicator />);
    await user.click(screen.getByRole('button'));

    expect(mockRetryAll).toHaveBeenCalled();
    expect(mockSyncNow).toHaveBeenCalled();
  });

  it('does not show label by default', () => {
    render(<SyncStatusIndicator />);
    expect(screen.queryByText('Synced')).not.toBeInTheDocument();
  });

  it('does not show count badge when no pending or failed', () => {
    render(<SyncStatusIndicator />);
    const button = screen.getByRole('button');
    // No badge elements inside
    const badges = button.querySelectorAll('span');
    expect(badges).toHaveLength(0);
  });

  it('prioritizes failed state over pending state', () => {
    mockMutationQueue = {
      ...mockMutationQueue,
      failedCount: 1,
      pendingCount: 3,
      hasFailed: true,
      hasPending: true,
    };
    render(<SyncStatusIndicator showLabel />);
    expect(screen.getByText('1 failed')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<SyncStatusIndicator className="custom-class" />);
    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });
});
