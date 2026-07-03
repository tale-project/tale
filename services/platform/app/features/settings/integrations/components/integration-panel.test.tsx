import { useCallback, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import { IntegrationPanel } from './integration-panel';

// Convex action used to lazy-load connector code on open — no-op here. The
// returned function must be stable across renders, otherwise the panel's
// connector-load effect (which depends on it) re-runs every render.
const readIntegrationFn = vi.fn().mockResolvedValue({ ok: false });
vi.mock('convex/react', () => ({
  useAction: () => readIntegrationFn,
}));

// Heavy child sections rely on Convex queries; they are irrelevant to the
// disconnect loading state, so stub them out.
vi.mock('./integration-details', () => ({
  IntegrationDetails: () => null,
}));
vi.mock('./integration-manage/integration-active-view', () => ({
  IntegrationActiveView: () => null,
}));
vi.mock('./integration-manage/integration-credentials-form-connected', () => ({
  IntegrationCredentialsFormConnected: () => null,
}));
vi.mock('./integration-manage/integration-icon-upload', () => ({
  IntegrationIconUpload: () => null,
}));
vi.mock('./integration-manage/integration-update-section', () => ({
  IntegrationUpdateSection: () => null,
}));
vi.mock('./integration-manage/slack-notification-config', () => ({
  SlackNotificationConfig: () => null,
}));

// Render the sheet shell inline so its footer (the Disconnect button) is in
// the DOM; the ConfirmDialog is a sibling of the sheet, so it is unaffected.
vi.mock('@/app/components/ui/overlays/sheet', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sheet">{children}</div>
  ),
}));

vi.mock('../hooks/use-integration-manage', () => ({
  useIntegrationManage: vi.fn(),
}));

import { useIntegrationManage } from '../hooks/use-integration-manage';

// Captured resolver for the in-flight disconnect promise — lets the test hold
// the disconnect "open" and then release it.
let resolveDisconnect: (() => void) | undefined;

const baseManage = {
  isActive: true,
  busy: false,
  isSubmitting: false,
  iconUrl: null,
  isSql: false,
  isUploadingIcon: false,
  iconInputRef: { current: null },
  operationCount: 0,
  handleOpenChange: vi.fn(),
  handleIconUpload: vi.fn(),
  testResult: null,
  setTestResult: vi.fn(),
  handleTestConnection: vi.fn(),
  handleReauthorize: vi.fn(),
  hasOAuth2Config: false,
  hasOAuth2Credentials: false,
  parsedUpdate: null,
  setParsedUpdate: vi.fn(),
  isParsingUpdate: false,
  isApplyingUpdate: false,
  updateParseError: null,
  setUpdateParseError: vi.fn(),
  handleUpdateFilesSelected: vi.fn(),
  handleApplyUpdate: vi.fn(),
  confirmDelete: false,
  setConfirmDelete: vi.fn(),
  handleUninstall: vi.fn(),
  selectedAuthMethod: 'api_key',
  hasChanges: false,
  isTesting: false,
  isSavingOAuth2: false,
  editableConfigFields: [],
};

// A stand-in for useIntegrationManage that exercises the real isSubmitting
// lifecycle: handleDisconnect flips it true, awaits a controllable promise,
// then flips it false in a finally (mirroring the production hook).
function useManageMock() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handleDisconnect = useCallback(() => {
    setIsSubmitting(true);
    return new Promise<void>((resolve) => {
      resolveDisconnect = resolve;
    }).finally(() => setIsSubmitting(false));
  }, []);
  return { ...baseManage, isSubmitting, busy: isSubmitting, handleDisconnect };
}

const integration = {
  _id: 'cred-1',
  title: 'Shopify',
  name: 'shopify',
  description: 'Sync products.',
  organizationId: 'org-1',
  authMethod: 'api_key',
  isActive: true,
} as Parameters<typeof IntegrationPanel>[0]['integration'];

function renderPanel() {
  return render(
    <IntegrationPanel
      open
      onOpenChange={vi.fn()}
      integration={integration}
      organizationId="org-1"
    />,
  );
}

describe('IntegrationPanel — disconnect loading state', () => {
  beforeEach(() => {
    resolveDisconnect = undefined;
    // The mock returns only the slice the panel reads; cast past the full hook
    // shape (52+ fields) which is irrelevant to the disconnect loading state.
    vi.mocked(useIntegrationManage).mockImplementation(useManageMock as never);
  });

  it('shows the dialog loading state and keeps it open until the disconnect resolves', async () => {
    renderPanel();

    const sheet = screen.getByTestId('sheet');
    // Footer Disconnect button is idle before any action.
    expect(within(sheet).getByText('Disconnect')).toBeInTheDocument();
    expect(
      within(sheet).queryByText('Disconnecting...'),
    ).not.toBeInTheDocument();

    // Open the confirmation dialog.
    fireEvent.click(within(sheet).getByText('Disconnect'));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Disconnect integration'),
    ).toBeInTheDocument();
    const confirmButton = within(dialog).getByRole('button', {
      name: 'Disconnect',
    });
    expect(confirmButton).not.toBeDisabled();

    // Confirm: the disconnect is now in flight (promise not yet resolved).
    await act(async () => {
      fireEvent.click(confirmButton);
    });

    // Dialog stays open and shows its loading state, confirm button disabled.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const loadingConfirm = within(screen.getByRole('dialog')).getByRole(
      'button',
      { name: 'Loading...' },
    );
    expect(loadingConfirm).toBeDisabled();

    // Footer Disconnect button reflects isSubmitting (spinner + label).
    expect(
      within(screen.getByTestId('sheet')).getByText('Disconnecting...'),
    ).toBeInTheDocument();

    // Resolve the in-flight disconnect → dialog closes.
    await act(async () => {
      resolveDisconnect?.();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByTestId('sheet')).queryByText('Disconnecting...'),
    ).not.toBeInTheDocument();
  });
});
