import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import {
  type AutomationSettings,
  parseAutomationSettings,
} from '@/lib/shared/schemas/automation_settings';
import { render, screen, waitFor } from '@/tests/utils/render';

// Two seams, because reads and writes go different ways: the files are READ by
// a cached query (mocked at the hook, whose contract is the values-by-file
// map) and WRITTEN by a Convex action.
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

import { AutomationSettingsForm } from './automation-settings-form';

/** Non-null fixture: a declaration the schema refuses is a broken test, not a
 *  case the component must handle. */
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
        { key: 'allow_fixture_rates', label: 'Fixture rates', type: 'boolean' },
      ],
    },
  ],
});
function mount(onSaved = vi.fn()) {
  // A real QueryClient: a save invalidates the values query, and that
  // invalidation is part of the contract (the form settles back to clean).
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <AutomationSettingsForm
        organizationId="org_1"
        projectId={'project_1' as Id<'projects'>}
        settings={SETTINGS}
        folder="Setup"
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onSaved };
}

describe('AutomationSettingsForm — setup mode', () => {
  it('prefills from the files, validates, and writes every form on save', async () => {
    convexMocks.read.mockReset();
    convexMocks.write.mockReset().mockResolvedValue({ action: 'created' });
    // Both files missing — a fresh project (the read twin answers {} per file).
    convexMocks.read.mockReturnValue({
      data: { 'identity.yaml': {}, 'fx-policy.yaml': {} },
      isPending: false,
      isError: false,
    });

    const { user, onSaved } = mount();

    expect(screen.getByText('Client identity')).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save and continue' });

    // Empty required fields refuse the save.
    await user.click(save);
    expect(convexMocks.write).not.toHaveBeenCalled();
    expect(screen.getAllByText('This field is required.')).not.toHaveLength(0);

    await user.type(
      screen.getByLabelText(/Legal name/),
      'Matterhorn Living GmbH',
    );
    await user.type(screen.getByLabelText(/VAT number/), 'CHE-123');
    await user.click(save);
    expect(convexMocks.write).not.toHaveBeenCalled();
    expect(
      screen.getByText("This doesn't match the expected format."),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/VAT number/));
    await user.type(screen.getByLabelText(/VAT number/), 'CHE123456789');
    await user.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(convexMocks.write).toHaveBeenCalledTimes(2);
    expect(convexMocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        folderName: 'Setup',
        fileName: 'identity.yaml',
        yaml: {
          organisation_name: 'Matterhorn Living GmbH',
          vat_number: 'CHE123456789',
        },
      }),
    );
    // The select's default and the determinate boolean are written out too.
    expect(convexMocks.write).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'fx-policy.yaml',
        yaml: { method: 'estv_monthly', allow_fixture_rates: 'false' },
      }),
    );
  });
});
