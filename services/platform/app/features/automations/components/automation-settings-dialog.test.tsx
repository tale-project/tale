import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import {
  type AutomationSettings,
  parseAutomationSettings,
} from '@/lib/shared/schemas/automation_settings';
import { render, screen, waitFor } from '@/tests/utils/render';

// Same two seams as the setup form's test: the files are READ through the
// values hook (contract = a values-by-file map) and WRITTEN by a Convex action.
const convexMocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: convexMocks.write }),
}));
vi.mock('../hooks/use-settings-values', () => ({
  settingsValuesQueryKey: (
    organizationId: string,
    projectId: string,
    folder: string,
  ) => ['automation-settings-values', organizationId, projectId, folder],
  useAutomationSettingsValues: () => convexMocks.read(),
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-toast', () => ({ toast: toastMock }));

// FormDialog reads the org from the route params (error-boundary context);
// there is no router in this render, so answer it directly.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_1',
}));

import { AutomationSettingsDialog } from './automation-settings-dialog';

function fixture(value: unknown): AutomationSettings {
  const parsed = parseAutomationSettings(value);
  if (parsed === null) throw new Error('fixture did not parse');
  return parsed;
}

const SETTINGS = fixture({
  folder: 'Setup',
  forms: [
    {
      file: 'identity.yaml',
      title: 'Client identity',
      required: true,
      fields: [
        {
          key: 'organisation_name',
          label: 'Legal name',
          type: 'text',
          required: true,
        },
        {
          key: 'vat_number',
          label: 'VAT number',
          type: 'text',
          required: true,
          pattern: String.raw`^CHE\d{9}$`,
        },
      ],
    },
    {
      file: 'fx-policy.yaml',
      title: 'FX conversion policy',
      fields: [
        {
          key: 'method',
          label: 'FX conversion method',
          type: 'select',
          required: true,
          default: 'estv_monthly',
          options: [
            { value: 'estv_monthly', label: 'ESTV monthly average' },
            { value: 'group_internal', label: 'Group rates' },
          ],
        },
      ],
    },
  ],
});

function mount(onOpenChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <AutomationSettingsDialog
        organizationId="org_1"
        projectId={'project_1' as Id<'projects'>}
        settings={SETTINGS}
        folder="Setup"
        automationName="vat-return-desk"
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange };
}

function seedFiles() {
  convexMocks.read.mockReset();
  convexMocks.read.mockReturnValue({
    data: {
      'identity.yaml': {
        organisation_name: 'Matterhorn Living GmbH',
        vat_number: 'CHE123456789',
      },
      'fx-policy.yaml': { method: 'group_internal' },
    },
    isPending: false,
    isError: false,
  });
}

describe('AutomationSettingsDialog', () => {
  it('shows one form per tab and ONE save, disarmed until something changes', async () => {
    seedFiles();
    convexMocks.write.mockReset().mockResolvedValue({ action: 'updated' });
    toastMock.mockReset();

    const { user } = mount();

    // One Save for the whole dialog — not one per declared file.
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    // The first tab's fields are the ones on screen; the other tab's are not.
    expect(screen.getByLabelText(/Legal name/)).toHaveValue(
      'Matterhorn Living GmbH',
    );
    expect(screen.queryByLabelText(/FX conversion method/)).toBeNull();

    await user.click(screen.getByRole('tab', { name: /FX conversion policy/ }));
    expect(screen.getByLabelText(/FX conversion method/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Legal name/)).toBeNull();
  });

  it('writes only the files the operator changed, and keeps edits across tabs', async () => {
    seedFiles();
    convexMocks.write.mockReset().mockResolvedValue({ action: 'updated' });
    toastMock.mockReset();

    const { user } = mount();

    await user.clear(screen.getByLabelText(/Legal name/));
    await user.type(screen.getByLabelText(/Legal name/), 'Matterhorn AG');

    // Switching tabs must not drop the edit — nothing is lost until Save.
    await user.click(screen.getByRole('tab', { name: /FX conversion policy/ }));
    await user.click(screen.getByRole('tab', { name: /Client identity/ }));
    expect(screen.getByLabelText(/Legal name/)).toHaveValue('Matterhorn AG');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(convexMocks.write).toHaveBeenCalledTimes(1));
    expect(convexMocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        folderName: 'Setup',
        fileName: 'identity.yaml',
        yaml: {
          organisation_name: 'Matterhorn AG',
          vat_number: 'CHE123456789',
        },
      }),
    );
    expect(toastMock).toHaveBeenCalled();
  });

  it('refuses an invalid value and reveals the tab that holds it', async () => {
    seedFiles();
    convexMocks.write.mockReset().mockResolvedValue({ action: 'updated' });

    const { user } = mount();

    await user.clear(screen.getByLabelText(/VAT number/));
    await user.type(screen.getByLabelText(/VAT number/), 'CHE-123');
    // Move away, so the refusal has to bring the operator back.
    await user.click(screen.getByRole('tab', { name: /FX conversion policy/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(convexMocks.write).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByText("This doesn't match the expected format."),
      ).toBeInTheDocument(),
    );
  });

  it('marks the tab whose form has unsaved edits', async () => {
    seedFiles();
    const { user } = mount();

    expect(screen.queryByLabelText('Unsaved changes')).toBeNull();
    await user.clear(screen.getByLabelText(/Legal name/));
    await user.type(screen.getByLabelText(/Legal name/), 'Matterhorn AG');
    expect(screen.getByLabelText('Unsaved changes')).toBeInTheDocument();
  });

  it('warns before discarding unsaved edits on close, and stays open when refused', async () => {
    seedFiles();
    const confirmSpy = vi
      .spyOn(globalThis, 'confirm')
      .mockImplementation(() => false);
    try {
      const { user, onOpenChange } = mount();
      await user.clear(screen.getByLabelText(/Legal name/));
      await user.type(screen.getByLabelText(/Legal name/), 'Matterhorn AG');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(confirmSpy).toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
