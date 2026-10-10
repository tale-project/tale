import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { LabelManageDialog } from './label-manage-dialog';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  seed: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateTaskLabel: () => ({ mutateAsync: mocks.create }),
  useUpdateTaskLabel: () => ({ mutateAsync: mocks.update }),
  useDeleteTaskLabel: () => ({ mutateAsync: mocks.remove }),
  useEnsureDefaultTaskLabels: () => ({ mutateAsync: mocks.seed }),
}));
vi.mock('../hooks/queries', () => ({
  useTaskLabels: () => ({ labels: [{ _id: 'label-1', name: 'Existing' }] }),
}));
vi.mock('@/app/lib/backend/adapters', () => ({ failureDetail: vi.fn() }));
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue(undefined);
  mocks.seed.mockResolvedValue(undefined);
});

async function openField(field: 'rename' | 'create') {
  const onOpenChange = vi.fn();
  const dialog = (open: boolean) => (
    <LabelManageDialog
      open={open}
      onOpenChange={onOpenChange}
      projectId="project-1"
      canEdit
    />
  );
  const { user, rerender } = render(dialog(true));
  if (field === 'rename') {
    await user.click(screen.getByRole('button', { name: 'labels.rename' }));
  }
  const input =
    field === 'rename'
      ? screen.getByDisplayValue('Existing')
      : screen.getByRole('textbox', { name: 'labels.namePlaceholder' });
  return {
    input,
    onOpenChange,
    mutation: field === 'rename' ? mocks.update : mocks.create,
    reopen: () => {
      rerender(dialog(false));
      rerender(dialog(true));
    },
  };
}

describe.each(['rename', 'create'] as const)(
  'LabelManageDialog %s IME',
  (field) => {
    it('accepts ordinary Enter and Escape after a composing field was unmounted', async () => {
      const { input, mutation, onOpenChange, reopen } = await openField(field);
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: 'にほん' } });
      reopen();
      expect(input).not.toBeInTheDocument();
      const reopened =
        field === 'rename'
          ? screen.getByDisplayValue('にほん')
          : screen.getByRole('textbox', { name: 'labels.namePlaceholder' });
      fireEvent.change(reopened, { target: { value: '日本' } });
      fireEvent.keyDown(reopened, { key: 'Enter' });
      await waitFor(() =>
        expect(mutation).toHaveBeenCalledExactlyOnceWith(
          field === 'rename'
            ? { labelId: 'label-1', name: '日本' }
            : { projectId: 'project-1', name: '日本' },
        ),
      );
      fireEvent.keyDown(
        screen.getByRole('textbox', { name: 'labels.namePlaceholder' }),
        { key: 'Escape' },
      );
      expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    });

    it.each([
      'composition events',
      'native isComposing',
      'Safari keyCode 229',
    ] as const)(
      'does not commit %s Enter, then commits the completed name once',
      async (mode) => {
        const { input, mutation } = await openField(field);
        fireEvent.compositionStart(input);
        fireEvent.change(input, { target: { value: 'にほ' } });
        if (mode !== 'composition events') fireEvent.compositionEnd(input);
        const candidateAccepted = fireEvent.keyDown(input, {
          key: 'Enter',
          code: 'Enter',
          isComposing: mode === 'native isComposing',
          keyCode: mode === 'Safari keyCode 229' ? 229 : 13,
        });
        expect(mutation).not.toHaveBeenCalled();
        expect(candidateAccepted).toBe(true);
        expect(input).toHaveValue('にほ');
        if (mode === 'composition events') fireEvent.compositionEnd(input);
        fireEvent.change(input, { target: { value: '日本語' } });
        fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
        await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
        expect(mutation).toHaveBeenCalledWith(
          field === 'rename'
            ? { labelId: 'label-1', name: '日本語' }
            : { projectId: 'project-1', name: '日本語' },
        );
      },
    );

    it('leaves composition alone on Escape and allows the next regular Enter', async () => {
      const { input, mutation, onOpenChange } = await openField(field);
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: 'にほ' } });
      fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 });
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('にほ');
      expect(mutation).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      fireEvent.compositionEnd(input);
      fireEvent.change(input, { target: { value: '日本語' } });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
      await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
    });

    it.each([false, true])(
      'preserves normal Enter with shiftKey=%s',
      async (shiftKey) => {
        const { input, mutation } = await openField(field);
        fireEvent.change(input, { target: { value: 'Completed' } });
        fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, shiftKey });
        await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
      },
    );

    it('does not commit on blur', async () => {
      const { input, mutation } = await openField(field);
      fireEvent.change(input, { target: { value: 'Draft' } });
      fireEvent.blur(input);
      expect(mutation).not.toHaveBeenCalled();
    });
  },
);

it('ordinary Escape still cancels rename without saving', async () => {
  const { input, mutation } = await openField('rename');
  fireEvent.change(input, { target: { value: 'Draft' } });
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 27 });
  expect(input).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'labels.rename' }),
  ).toBeInTheDocument();
  expect(mutation).not.toHaveBeenCalled();
});
