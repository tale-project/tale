// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import type { RefusedSend } from '../hooks/use-bulk-actions';
import { BulkSendDialog } from './bulk-send-dialog';

afterEach(() => {
  cleanup();
});

/**
 * After a refused send the dialog stays open over the message: it names
 * whom the send did not reach, and why when the refusal says, and hands
 * focus back to the message (#3924). Rendered in English through the real
 * catalogs.
 */
describe('BulkSendDialog after a refused send', () => {
  const refused: RefusedSend[] = [
    { id: 'c2', name: 'Bravo Ltd', reason: 'Mailbox is paused' },
    { id: 'c3', name: 'Charlie' },
  ];

  it('names whom it did not reach, keeps the typed message and focuses it', async () => {
    const onConfirm = vi.fn();
    const props = { onConfirm, onCancel: vi.fn() };
    const { user, rerender } = render(
      <BulkSendDialog
        {...props}
        selectedCount={3}
        isSending={false}
        refused={[]}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Message' });
    await user.type(field, 'First line{Enter}Use <price> & A&B');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onConfirm).toHaveBeenCalledWith('First line\nUse <price> & A&B');

    rerender(
      <BulkSendDialog {...props} selectedCount={3} isSending refused={[]} />,
    );
    expect(field).toBeDisabled();

    rerender(
      <BulkSendDialog
        {...props}
        selectedCount={2}
        isSending={false}
        refused={refused}
      />,
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleName('Send 2 Messages');
    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveTextContent("2 messages weren't sent");
    expect(alert).toHaveTextContent(
      "Only these conversations are still selected, and your message is kept. Send tries them again; the messages that went out aren't sent twice.",
    );
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Bravo Ltd — Mailbox is paused', 'Charlie']);
    expect(field).toHaveValue('First line\nUse <price> & A&B');
    expect(field).toBeEnabled();
    expect(field).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    await checkAccessibility(dialog);
  });

  it('counts the refused conversations it does not list', () => {
    render(
      <BulkSendDialog
        selectedCount={12}
        isSending={false}
        refused={Array.from({ length: 12 }, (_, i) => ({
          id: `c${i}`,
          name: `Customer ${i}`,
        }))}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const items = within(screen.getByRole('alert')).getAllByRole('listitem');
    expect(items).toHaveLength(11);
    expect(items.at(-1)).toHaveTextContent('2 more conversations');
  });

  it('offers no Send once no selected conversation is left in the list', async () => {
    const { user } = render(
      <BulkSendDialog
        selectedCount={0}
        isSending={false}
        refused={refused}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Hi');

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });
});
