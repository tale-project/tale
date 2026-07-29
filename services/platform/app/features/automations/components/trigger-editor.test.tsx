import { within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TriggerEditor } from './trigger-editor';

const mockSetTrigger = vi.fn();
const mockDeleteTrigger = vi.fn();

let triggersData:
  | Array<{
      name: string;
      kind: string;
      cron?: string;
      timezone?: string;
      event?: string;
      hasToken: boolean;
      enabled: boolean;
      lastFiredAt?: number;
    }>
  | undefined;

vi.mock('../hooks/queries', () => ({
  useAutomationTriggers: () => ({ data: triggersData }),
}));

vi.mock('../hooks/mutations', () => ({
  useSetAutomationTrigger: () => ({
    mutate: mockSetTrigger,
    isPending: false,
  }),
  useDeleteAutomationTrigger: () => ({
    mutate: mockDeleteTrigger,
    isPending: false,
  }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const SCHEDULE_ROW = {
  name: 'gmail-triage-inbox',
  kind: 'schedule',
  cron: '0 */6 * * *',
  timezone: 'UTC',
  hasToken: false,
  enabled: true,
};

describe('TriggerEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggersData = [SCHEDULE_ROW];
  });

  it('shows the stored binding and refuses a no-op save', () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit
      />,
    );

    expect(screen.getByLabelText('Cron')).toHaveValue('0 */6 * * *');
    // `disabledReason` keeps the button focusable, so it disables via ARIA.
    expect(
      screen.getByRole('button', { name: 'Save trigger' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('saves an edited schedule binding', async () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit
      />,
    );

    const cron = screen.getByLabelText('Cron');
    await userEvent.clear(cron);
    await userEvent.type(cron, '0 9 * * 1');
    await userEvent.click(screen.getByRole('button', { name: 'Save trigger' }));

    expect(mockSetTrigger).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        name: 'gmail-triage-inbox',
        trigger: {
          kind: 'schedule',
          cron: '0 9 * * 1',
          timezone: 'UTC',
          enabled: true,
        },
      },
      expect.anything(),
    );
  });

  it('shows a minted webhook token exactly where the save reported it', async () => {
    triggersData = [];
    mockSetTrigger.mockImplementation(
      (
        _args: unknown,
        options?: { onSuccess?: (result: { token?: string }) => void },
      ) => {
        options?.onSuccess?.({ token: 'wht_secret_1' });
      },
    );
    render(
      <TriggerEditor organizationId="org-1" name="fresh-automation" canEdit />,
    );

    await userEvent.click(screen.getByRole('combobox', { name: 'Kind' }));
    await userEvent.click(screen.getByRole('option', { name: 'Webhook' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save trigger' }));

    expect(screen.getByText('wht_secret_1')).toBeInTheDocument();
    expect(
      screen.getByText(/shown once and stored only as a hash/),
    ).toBeInTheDocument();
  });

  it('renders read-only for members: binding visible, no controls', () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit={false}
      />,
    );

    expect(screen.getByLabelText('Cron')).toHaveAttribute('readonly');
    expect(
      screen.queryByRole('button', { name: 'Save trigger' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove trigger' }),
    ).not.toBeInTheDocument();
  });

  it('removes the binding only through the confirm dialog', async () => {
    render(
      <TriggerEditor
        organizationId="org-1"
        name="gmail-triage-inbox"
        canEdit
      />,
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Remove trigger' }),
    );
    expect(mockDeleteTrigger).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', {
      name: 'Remove the trigger?',
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Remove trigger' }),
    );
    expect(mockDeleteTrigger).toHaveBeenCalledWith(
      { organizationId: 'org-1', name: 'gmail-triage-inbox' },
      expect.anything(),
    );
  });
});
