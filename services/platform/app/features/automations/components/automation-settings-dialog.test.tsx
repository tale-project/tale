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
          key: 'case_id',
          label: 'Case ID',
          type: 'text',
          required: true,
          pattern: String.raw`^CASE-\d{6}$`,
        },
      ],
    },
    {
      file: 'validation-policy.yaml',
      title: 'Validation policy',
      fields: [
        {
          key: 'method',
          label: 'Validation profile',
          type: 'select',
          required: true,
          default: 'strict_rules',
          options: [
            { value: 'strict_rules', label: 'Strict checklist' },
            { value: 'custom_rules', label: 'Custom checklist' },
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
        automationName="document-verify-desk"
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
        organisation_name: 'Acme Corp',
        case_id: 'CASE-123456',
      },
      'validation-policy.yaml': { method: 'custom_rules' },
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
    expect(screen.getByLabelText(/Legal name/)).toHaveValue('Acme Corp');
    expect(screen.queryByLabelText(/Validation profile/)).toBeNull();

    await user.click(screen.getByRole('tab', { name: /Validation policy/ }));
    expect(screen.getByLabelText(/Validation profile/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Legal name/)).toBeNull();
  });

  it('writes only the files the operator changed, and keeps edits across tabs', async () => {
    seedFiles();
    convexMocks.write.mockReset().mockResolvedValue({ action: 'updated' });
    toastMock.mockReset();

    const { user } = mount();

    await user.clear(screen.getByLabelText(/Legal name/));
    await user.type(screen.getByLabelText(/Legal name/), 'Acme Holdings');

    // Switching tabs must not drop the edit — nothing is lost until Save.
    await user.click(screen.getByRole('tab', { name: /Validation policy/ }));
    await user.click(screen.getByRole('tab', { name: /Client identity/ }));
    expect(screen.getByLabelText(/Legal name/)).toHaveValue('Acme Holdings');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(convexMocks.write).toHaveBeenCalledTimes(1));
    expect(convexMocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        folderName: 'Setup',
        fileName: 'identity.yaml',
        yaml: {
          organisation_name: 'Acme Holdings',
          case_id: 'CASE-123456',
        },
      }),
    );
    expect(toastMock).toHaveBeenCalled();
  });

  it('refuses an invalid value and reveals the tab that holds it', async () => {
    seedFiles();
    convexMocks.write.mockReset().mockResolvedValue({ action: 'updated' });

    const { user } = mount();

    await user.clear(screen.getByLabelText(/Case ID/));
    await user.type(screen.getByLabelText(/Case ID/), 'CASE-999');
    // Move away, so the refusal has to bring the operator back.
    await user.click(screen.getByRole('tab', { name: /Validation policy/ }));
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
    await user.type(screen.getByLabelText(/Legal name/), 'Acme Holdings');
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
      await user.type(screen.getByLabelText(/Legal name/), 'Acme Holdings');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(confirmSpy).toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
