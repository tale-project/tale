import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompetenceRecordWire } from '@/app/lib/backend/contract/governance';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { EditCompetenceDialog } from './edit-competence-dialog';

const DAY = 24 * 60 * 60 * 1000;

const state = vi.hoisted(() => ({
  update: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateCompetence: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: state.toast }),
}));

function grant(overrides: Partial<CompetenceRecordWire> = {}) {
  return {
    id: 'record-a',
    userId: 'user-worker',
    competence: 'tax-reviewer',
    grantedBy: 'user-admin',
    grantedAt: Date.now() - DAY,
    expiresAt: Date.now() + 10 * DAY,
    revokedAt: null,
    revokedBy: null,
    evidence: 'Certified 2025',
    ...overrides,
  } satisfies CompetenceRecordWire;
}

beforeEach(() => {
  vi.clearAllMocks();
});

function renderDialog(record: CompetenceRecordWire = grant()) {
  const onOpenChange = vi.fn();
  const onRefused = vi.fn();
  const utils = render(
    <EditCompetenceDialog
      open
      onOpenChange={onOpenChange}
      organizationId="org-a"
      record={record}
      competenceName="tax-reviewer"
      memberName="Integration Worker"
      onRefused={onRefused}
    />,
  );
  return { ...utils, onOpenChange, onRefused };
}

describe('EditCompetenceDialog [GOV-R18]', () => {
  it('starts from the grant and saves nothing until something changes', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/"tax-reviewer" for Integration Worker/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole('combobox', { name: 'Expires' }),
    ).toHaveTextContent(/^Unchanged \(until /);
    expect(
      within(dialog).getByRole('textbox', { name: 'Evidence' }),
    ).toHaveValue('Certified 2025');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('moves the expiry and changes the evidence', async () => {
    state.update.mockResolvedValue({ changed: true });
    const { user, onOpenChange } = renderDialog();

    await user.click(screen.getByRole('combobox', { name: 'Expires' }));
    await user.click(await screen.findByRole('option', { name: 'In 1 year' }));
    const evidence = screen.getByRole('textbox', { name: 'Evidence' });
    await user.clear(evidence);
    await user.type(evidence, '  Certified 2026 ');
    const before = Date.now();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const after = Date.now();

    expect(state.update).toHaveBeenCalledTimes(1);
    const args = state.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({
      organizationId: 'org-a',
      recordId: 'record-a',
      evidence: 'Certified 2026',
    });
    expect(args.expiresAt).toBeGreaterThanOrEqual(before + 365 * DAY);
    expect(args.expiresAt).toBeLessThanOrEqual(after + 365 * DAY);
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Competence updated' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sends only what changed: no expiry, and the evidence cleared', async () => {
    state.update.mockResolvedValue({ changed: true });
    const { user } = renderDialog();

    await user.click(screen.getByRole('combobox', { name: 'Expires' }));
    await user.click(await screen.findByRole('option', { name: 'Never' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.update).toHaveBeenLastCalledWith({
      organizationId: 'org-a',
      recordId: 'record-a',
      expiresAt: null,
    });
  });

  it('clears the evidence of an open-ended grant and keeps it open-ended', async () => {
    state.update.mockResolvedValue({ changed: true });
    const { user } = renderDialog(grant({ expiresAt: null }));

    expect(screen.getByRole('combobox', { name: 'Expires' })).toHaveTextContent(
      'Never',
    );
    await user.clear(screen.getByRole('textbox', { name: 'Evidence' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.update).toHaveBeenLastCalledWith({
      organizationId: 'org-a',
      recordId: 'record-a',
      evidence: null,
    });
  });

  it('keeps a refusal beside the fields and reloads the register', async () => {
    state.update.mockRejectedValue({ data: { code: 'COMPETENCE_EXPIRED' } });
    const { user, onOpenChange, onRefused } = renderDialog();

    await user.type(
      screen.getByRole('textbox', { name: 'Evidence' }),
      ' and 2026',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(
        'This grant has expired. Grant the competence again instead.',
      ),
    ).toBeInTheDocument();
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(state.toast).not.toHaveBeenCalled();
  });

  it('passes an axe audit when open', async () => {
    renderDialog();
    await screen.findByRole('dialog');
    await checkAccessibility(document.body);
  });
});
