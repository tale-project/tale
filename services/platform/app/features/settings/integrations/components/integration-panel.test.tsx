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
  // Disconnect lives here now (beside Test connection); render a minimal
  // stand-in so the disconnect-loading test can still drive it.
  IntegrationActiveView: ({
    onDisconnect,
    isDisconnecting,
  }: {
    onDisconnect: () => void;
    isDisconnecting: boolean;
  }) => (
    <button type="button" onClick={onDisconnect}>
      {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
    </button>
  ),
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

  it('titles the sheet with the integration name, not a generic mode label', () => {
    vi.mocked(useIntegrationManage).mockImplementation(
      () =>
        ({
          ...baseManage,
          isActive: false,
        }) as never,
    );
    renderPanel();
    // Connect flow used to say "Add integration" — that hid which product
    // you were connecting after opening from a named catalog card.
    expect(screen.getByText('Shopify')).toBeInTheDocument();
    expect(screen.queryByText('Add integration')).not.toBeInTheDocument();
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

describe('IntegrationPanel — confirm dialogs name the instance', () => {
  // Several instances of one integration can share a base title and differ only
  // by their identity (login/host/domain), so the destructive confirms must show
  // it — otherwise you can't tell which look-alike instance you're about to
  // disconnect or delete.
  const integrationWithIdentity = {
    ...integration,
    authMethod: 'basic_auth',
    basicAuth: { username: 'support@acme.test' },
  } as Parameters<typeof IntegrationPanel>[0]['integration'];

  it('shows the instance title + identity in the delete confirm', () => {
    vi.mocked(useIntegrationManage).mockImplementation(
      () =>
        ({
          ...baseManage,
          isActive: true,
          confirmDelete: true,
          handleUninstall: vi.fn(),
        }) as never,
    );
    render(
      <IntegrationPanel
        open
        onOpenChange={vi.fn()}
        integration={integrationWithIdentity}
        organizationId="org-1"
      />,
    );
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Shopify')).toBeInTheDocument();
    expect(within(dialog).getByText('support@acme.test')).toBeInTheDocument();
  });

  it('shows the instance title + identity in the disconnect confirm', async () => {
    vi.mocked(useIntegrationManage).mockImplementation(
      () =>
        ({
          ...baseManage,
          isActive: true,
          handleDisconnect: vi.fn().mockResolvedValue(undefined),
        }) as never,
    );
    render(
      <IntegrationPanel
        open
        onOpenChange={vi.fn()}
        integration={integrationWithIdentity}
        organizationId="org-1"
      />,
    );
    // Open the disconnect confirm via the (stubbed) active-view button.
    fireEvent.click(
      within(screen.getByTestId('sheet')).getByText('Disconnect'),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Shopify')).toBeInTheDocument();
    expect(within(dialog).getByText('support@acme.test')).toBeInTheDocument();
  });
});

describe('IntegrationPanel — duplicate action', () => {
  beforeEach(() => {
    // A connected integration renders the details-mode footer.
    vi.mocked(useIntegrationManage).mockImplementation(
      () => baseManage as never,
    );
  });

  it('renders a Duplicate button that fires onDuplicate', () => {
    const onDuplicate = vi.fn();
    render(
      <IntegrationPanel
        open
        onOpenChange={vi.fn()}
        integration={integration}
        organizationId="org-1"
        onDuplicate={onDuplicate}
      />,
    );
    // With 1–2 secondary actions the footer renders inline buttons (no ⋯ menu).
    const sheet = screen.getByTestId('sheet');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Duplicate' }));
    expect(onDuplicate).toHaveBeenCalledOnce();
  });

  it('omits the Duplicate button when onDuplicate is not provided', () => {
    render(
      <IntegrationPanel
        open
        onOpenChange={vi.fn()}
        integration={integration}
        organizationId="org-1"
        onExport={vi.fn()}
      />,
    );
    const sheet = screen.getByTestId('sheet');
    // Export renders as an inline button; Duplicate does not.
    expect(
      within(sheet).getByRole('button', { name: 'Export' }),
    ).toBeInTheDocument();
    expect(
      within(sheet).queryByRole('button', { name: 'Duplicate' }),
    ).not.toBeInTheDocument();
  });
});

describe('IntegrationPanel — delete a disconnected removable instance', () => {
  it('offers Delete on the disconnected footer and opens the confirm dialog', () => {
    const setConfirmDelete = vi.fn();
    vi.mocked(useIntegrationManage).mockImplementation(
      () =>
        ({
          ...baseManage,
          isActive: false,
          isRemovable: true,
          confirmDelete: false,
          setConfirmDelete,
          handleDeleteInstance: vi.fn(),
        }) as never,
    );
    render(
      <IntegrationPanel
        open
        onOpenChange={vi.fn()}
        integration={integration}
        organizationId="org-1"
      />,
    );
    const sheet = screen.getByTestId('sheet');
    // A disconnected duplicate is deletable even though it was never connected.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    expect(setConfirmDelete).toHaveBeenCalledWith(true);
  });
});
