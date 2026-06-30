// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { cleanup, render, screen } from '@/tests/utils/render';

import { BulkSendDialog } from './bulk-send-dialog';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  cleanup();
});

describe('BulkSendDialog', () => {
  it('passes axe audit', async () => {
    const { container } = render(
      <BulkSendDialog
        selectedCount={3}
        isSending={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await checkAccessibility(container);
  });

  it('keeps Send disabled until the body is non-empty', async () => {
    const { user } = render(
      <BulkSendDialog
        selectedCount={2}
        isSending={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const sendButton = screen.getByRole('button', { name: 'bulkSend.send' });
    expect(sendButton).toBeDisabled();

    // Whitespace-only input must not enable Send.
    const textarea = screen.getByLabelText('bulkSend.messageLabel');
    await user.type(textarea, '   ');
    expect(sendButton).toBeDisabled();

    await user.type(textarea, 'Hello');
    expect(sendButton).toBeEnabled();
  });

  it('calls onConfirm with the trimmed body', async () => {
    const onConfirm = vi.fn();
    const { user } = render(
      <BulkSendDialog
        selectedCount={1}
        isSending={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText('bulkSend.messageLabel');
    await user.type(textarea, '  Thanks for reaching out  ');
    await user.click(screen.getByRole('button', { name: 'bulkSend.send' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('Thanks for reaching out');
  });

  it('disables inputs and Cancel while sending', () => {
    render(
      <BulkSendDialog
        selectedCount={1}
        isSending={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('bulkSend.messageLabel')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'actions.cancel' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'bulkSend.send' }),
    ).toBeDisabled();
  });

  it('invokes onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const { user } = render(
      <BulkSendDialog
        selectedCount={1}
        isSending={false}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'actions.cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
