// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import messages from '../../i18n/messages/en.yml';
import { EnvVarListEditor, type LoadedEnvVar } from './env-var-list-editor';

// The inline Save reports through the standalone `toast`; one shared spy
// makes the failure toast assertable.
const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@tale/ui/use-toast', () => ({ toast: toastMock }));

const plainRows: LoadedEnvVar[] = [
  { key: 'FOO', isSecret: false, value: 'bar' },
];

function setup(
  rows: readonly LoadedEnvVar[] = plainRows,
  projectSecretNameRule?: boolean,
) {
  const onSet = vi.fn().mockResolvedValue(undefined);
  const onDelete = vi.fn().mockResolvedValue(undefined);
  const utils = render(
    <EnvVarListEditor
      projectSecretNameRule={projectSecretNameRule}
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

  it('enables Save only once an added row has a key (a blank row is not savable)', () => {
    setup();
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    // A blank new row carries nothing to persist — Save stays disabled until it
    // has a key, so merely clicking Add can't arm the navigation blocker.
    expect(saveBtn).toBeDisabled();

    const keys = screen.getAllByPlaceholderText('NAME');
    fireEvent.change(keys[keys.length - 1], { target: { value: 'NEW_KEY' } });
    expect(saveBtn).toBeEnabled();
  });

  it('re-disables Save when a just-added row is removed again (net-zero edit)', async () => {
    setup([]);
    const saveBtn = screen.getByRole('button', { name: 'Save' });

    // Add a row and give it content, arming Save…
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByPlaceholderText('NAME'), {
      target: { value: 'TEMP' },
    });
    expect(saveBtn).toBeEnabled();

    // …then remove it. The live rows now match the loaded snapshot, so the form
    // is clean again — no lingering "discard changes?" prompt on navigate-away.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(saveBtn).toBeDisabled());
  });

  it('hides the per-row Secret toggle in forceSecret mode', () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <EnvVarListEditor
        forceSecret
        rows={[{ key: 'API_KEY', isSecret: true, maskedValue: '••••' }]}
        isLoading={false}
        onSet={onSet}
        onDelete={onDelete}
      />,
    );
    // Every row is a secret, so the Value/Secret checkbox never renders.
    expect(
      screen.queryByRole('checkbox', { name: 'Secret' }),
    ).not.toBeInTheDocument();
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

  it('saves a token-source binding with the selected slug', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(
      <EnvVarListEditor
        rows={[
          { key: 'ANTHROPIC_AUTH_TOKEN', isSecret: true, maskedValue: '••••' },
        ]}
        isLoading={false}
        tokenSources={[
          { slug: 'pool-a', displayName: 'Pool A' },
          { slug: 'pool-b', displayName: 'Pool B' },
        ]}
        onSet={onSet}
        onDelete={onDelete}
      />,
    );

    // Type chooser appears when token sources are provided.
    const typeSelect = screen.getByRole('combobox', { name: 'Type' });
    fireEvent.click(typeSelect);
    fireEvent.click(
      await screen.findByRole('option', { name: 'Token source' }),
    );

    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(onSet).toHaveBeenCalledWith({
        key: 'ANTHROPIC_AUTH_TOKEN',
        value: '',
        isSecret: true,
        tokenSourceSlug: 'pool-a',
      }),
    );
  });
});

/** A backend refusal as a host rethrows it: the platform's `AppError` keeps
 * the payload on `data` and serializes it into `message`, for logs. */
function structuredRefusal(): Error {
  const data = {
    code: 'UNAUTHORIZED',
    message: 'Your session has ended. Sign in again.',
  };
  return Object.assign(new Error(JSON.stringify(data)), { data });
}

describe('EnvVarListEditor — inline save failure', () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it("puts the host's sentence under the failure title", async () => {
    const { onSet } = setup();
    onSet.mockRejectedValueOnce(
      new Error('Your session has ended. Sign in again.'),
    );

    fireEvent.change(screen.getByPlaceholderText('value'), {
      target: { value: 'baz' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "Couldn't save environment",
        description: 'Your session has ended. Sign in again.',
        variant: 'destructive',
      }),
    );
  });

  // A host that rethrew a refusal as-is used to put `{"code":…}` under the
  // title: `AppError.message` is the serialized payload.
  it.each(['onSet', 'onDelete'] as const)(
    "never prints a structured error's payload when %s rejects",
    async (callback) => {
      const { onSet, onDelete } = setup();
      if (callback === 'onSet') {
        onSet.mockRejectedValueOnce(structuredRefusal());
        fireEvent.change(screen.getByPlaceholderText('value'), {
          target: { value: 'baz' },
        });
      } else {
        onDelete.mockRejectedValueOnce(structuredRefusal());
        fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
      }
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(toastMock).toHaveBeenCalledWith({
          title: "Couldn't save environment",
          description: 'Something went wrong. Try again.',
          variant: 'destructive',
        }),
      );
      expect(toastMock.mock.calls.flat()).not.toContainEqual(
        expect.objectContaining({
          description: expect.stringContaining('"code"'),
        }),
      );
    },
  );
});

describe('EnvVarListEditor — project secret name rule', () => {
  beforeEach(() => toastMock.mockClear());

  function addKey(key: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    const inputs = screen.getAllByPlaceholderText('NAME');
    fireEvent.change(inputs[inputs.length - 1], { target: { value: key } });
  }

  it.each(['_TOKEN', 'A'.repeat(65)])(
    'rejects invalid project name %s before any write',
    async (key) => {
      const { onSet, onDelete } = setup([], true);
      addKey(key);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(toastMock).toHaveBeenCalledWith({
          title: messages.envEditor.projectSecretBadKey.replace('{key}', key),
          variant: 'destructive',
        }),
      );
      expect(onSet).not.toHaveBeenCalled();
      expect(onDelete).not.toHaveBeenCalled();
    },
  );

  it('rejects token and TOKEN as duplicates before any write', async () => {
    const { onSet, onDelete } = setup([], true);
    addKey('token');
    addKey('TOKEN');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: messages.envEditor.dupKey,
        variant: 'destructive',
      }),
    );
    expect(onSet).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('normalizes a lowercase project name and accepts the 64-character boundary', async () => {
    const { onSet } = setup([], true);
    addKey('token');
    addKey('A'.repeat(64));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSet).toHaveBeenCalledTimes(2));
    expect(onSet).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'TOKEN' }),
    );
    expect(onSet).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'A'.repeat(64) }),
    );
  });

  it('keeps underscore, long names and case-sensitive keys valid by default', async () => {
    const { onSet } = setup([]);
    for (const key of ['_TOKEN', 'A'.repeat(65), 'token', 'TOKEN']) addKey(key);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSet).toHaveBeenCalledTimes(4));
    for (const key of ['_TOKEN', 'A'.repeat(65), 'token', 'TOKEN']) {
      expect(onSet).toHaveBeenCalledWith(
        expect.objectContaining({ key, isSecret: false }),
      );
    }
    expect(toastMock).toHaveBeenCalledWith({
      title: messages.envEditor.saved,
      variant: 'success',
    });
  });
});
