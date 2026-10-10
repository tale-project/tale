// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { MessageEditForm } from './message-edit-form';

/**
 * The edit form closes only once the edit STARTED. A fork the door refuses
 * before anything is written — a reached usage cap — resolves `false`, and
 * the form stays open with the draft intact instead of eating it; while the
 * verdict is pending, Send is disabled so a second Enter cannot fork twice.
 */
describe('MessageEditForm', () => {
  it.each(['mirror', 'native', 'Safari'])(
    'leaves Enter and Escape to the IME (%s)',
    (signal) => {
      const onSubmit = vi.fn(async () => true);
      const onCancel = vi.fn();
      render(
        <MessageEditForm
          initialText="hello"
          onSubmit={onSubmit}
          onCancel={onCancel}
        />,
      );
      const field = screen.getByRole('textbox', { name: 'Edit message' });
      fireEvent.compositionStart(field);
      fireEvent.change(field, { target: { value: 'にほん' } });
      if (signal !== 'mirror') fireEvent.compositionEnd(field);
      const flags = {
        isComposing: signal === 'native',
        keyCode: signal === 'Safari' ? 229 : 13,
      };
      expect(fireEvent.keyDown(field, { key: 'Enter', ...flags })).toBe(true);
      fireEvent.keyDown(field, { key: 'Escape', ...flags });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(field).toHaveValue('にほん');
      fireEvent.compositionEnd(field);
      fireEvent.change(field, { target: { value: '日本' } });
      fireEvent.keyDown(field, { key: 'Enter' });
      fireEvent.keyDown(field, { key: 'Enter' });
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith('日本');
    },
  );

  it('keeps Shift+Enter, blur and ordinary Escape unchanged', () => {
    const onSubmit = vi.fn(async () => true);
    const onCancel = vi.fn();
    render(
      <MessageEditForm
        initialText="hello"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Edit message' });
    fireEvent.change(field, { target: { value: 'hello again' } });
    expect(fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })).toBe(
      true,
    );
    fireEvent.blur(field);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  function pendingSubmit() {
    let verdict: (accepted: boolean) => void = () => {};
    const onSubmit = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          verdict = resolve;
        }),
    );
    return { onSubmit, settle: (accepted: boolean) => verdict(accepted) };
  }

  it('keeps the draft open and re-enables Send when the edit is refused', async () => {
    const { onSubmit, settle } = pendingSubmit();
    const { user } = render(
      <MessageEditForm
        initialText="hello"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Edit message' });
    await user.clear(field);
    await user.type(field, 'hello there');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();

    await user.click(send);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('hello there');
    // Pending: a second Enter in the field must not submit again.
    expect(send).toBeDisabled();
    await user.type(field, '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);

    settle(false);
    await waitFor(() => expect(send).toBeEnabled());
    expect(field).toHaveValue('hello there');
    expect(field).toBeInTheDocument();
  });

  it('stays pending once the edit is accepted — the owner swaps the form out', async () => {
    const { onSubmit, settle } = pendingSubmit();
    const { user } = render(
      <MessageEditForm
        initialText="hello"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Edit message' });
    await user.type(field, ' again');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    settle(true);
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('re-enables Send when starting the edit throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn(() => Promise.reject(new Error('offline')));
    const { user } = render(
      <MessageEditForm
        initialText="hello"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Edit message' }),
      ' again',
    );
    const send = screen.getByRole('button', { name: 'Send' });
    await user.click(send);
    await waitFor(() => expect(send).toBeEnabled());
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
