// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { EnvVarListEditor, type LoadedEnvVar } from './env-var-list-editor';

const plainRows: LoadedEnvVar[] = [
  { key: 'FOO', isSecret: false, value: 'bar' },
];

function setup(rows: readonly LoadedEnvVar[] = plainRows) {
  const onSet = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <EnvVarListEditor
      rows={rows}
      isLoading={false}
      onSet={onSet}
      onDelete={onDelete}
    />,
  );
  return { onSet, onDelete, ...utils };
}

describe('EnvVarListEditor — Save dirty state', () => {
  it('disables Save with no edits', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('enables Save after editing a value, then re-disables after a successful save', async () => {
    const { onSet } = setup();
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('value'), {
      target: { value: 'baz' },
    });
    expect(saveBtn).toBeEnabled();

    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(onSet).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'FOO', value: 'baz', isSecret: false }),
      ),
    );
    // The core fix: after a successful save the button greys out again.
    await waitFor(() => expect(saveBtn).toBeDisabled());
  });

  it('enables Save when a row is added', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('keeps Save disabled when a stored secret is merely focused (mask is display-only)', () => {
    setup([{ key: 'TOKEN', isSecret: true, maskedValue: 'sk-****xyz' }]);
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).toBeDisabled();

    // The secret renders its mask preview as the value; focusing clears it for a
    // clean re-type but must not mark the form dirty.
    fireEvent.focus(screen.getByDisplayValue('sk-****xyz'));
    expect(saveBtn).toBeDisabled();
  });
});
