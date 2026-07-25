import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `handleReconnect` reactivates a disconnected integration from its RETAINED
 * credentials. It must TEST before it activates: a credential can rot while
 * disconnected (the mailbox password changed, the API key was rotated), and
 * activating on faith would flip the badge to Connected while every sync fails
 * silently — the worst failure mode here, because nothing surfaces it.
 */

const mockTestConnection = vi.fn();
const mockUpdateCredentials = vi.fn();
const mockToast = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('convex/react', () => ({ useAction: () => vi.fn() }));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: { integrations: { file_actions: {} } },
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('./actions', () => ({
  useTestIntegration: () => ({
    mutateAsync: mockTestConnection,
    isPending: false,
  }),
  useGenerateIntegrationOAuth2Url: () => ({ mutateAsync: vi.fn() }),
  useSaveOAuth2Credentials: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('./mutations', () => ({
  useUpdateCredentials: () => ({ mutateAsync: mockUpdateCredentials }),
  useGenerateUploadUrl: () => ({ mutateAsync: vi.fn() }),
}));

const { useIntegrationManage } = await import('./use-integration-manage');

const integration = {
  _id: 'cred-1',
  title: 'Support mailbox',
  name: 'imap_smtp-2',
  organizationId: 'org-1',
  authMethod: 'basic_auth',
  isActive: false,
  basicAuth: { username: 'hello@support.example.com' },
} as Parameters<typeof useIntegrationManage>[0];

function renderManage() {
  return renderHook(() =>
    useIntegrationManage(integration, vi.fn(), true, 'org-1'),
  );
}

describe('useIntegrationManage — handleReconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('activates the credential once the retained login tests clean', async () => {
    mockTestConnection.mockResolvedValue({ success: true });
    const { result } = renderManage();

    await act(async () => {
      await result.current.handleReconnect();
    });

    expect(mockTestConnection).toHaveBeenCalledWith({ credentialId: 'cred-1' });
    expect(mockUpdateCredentials).toHaveBeenCalledWith({
      credentialId: 'cred-1',
      isActive: true,
      status: 'active',
    });
  });

  it('does NOT activate when the retained login no longer works', async () => {
    mockTestConnection.mockResolvedValue({
      success: false,
      message: 'Invalid credentials',
    });
    const { result } = renderManage();

    await act(async () => {
      await result.current.handleReconnect();
    });

    expect(mockUpdateCredentials).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: 'Invalid credentials',
      }),
    );
  });

  it('does NOT activate when the test itself throws', async () => {
    mockTestConnection.mockRejectedValue(new Error('network down'));
    const { result } = renderManage();

    await act(async () => {
      await result.current.handleReconnect();
    });

    expect(mockUpdateCredentials).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });
});
