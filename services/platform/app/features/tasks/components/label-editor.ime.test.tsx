import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import { LabelEditor } from './label-editor';

const mocks = vi.hoisted(() => ({ create: vi.fn(), seed: vi.fn() }));

vi.mock('../hooks/mutations', () => ({
  useCreateTaskLabel: () => ({ mutateAsync: mocks.create }),
  useEnsureDefaultTaskLabels: () => ({ mutateAsync: mocks.seed }),
}));
vi.mock('../hooks/queries', () => ({
  useTaskLabels: () => ({ labels: [{ _id: 'label-1', name: '日本語' }] }),
}));
vi.mock('@/app/lib/backend/adapters', () => ({ failureDetail: vi.fn() }));
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue(undefined);
  mocks.seed.mockResolvedValue(undefined);
});

async function openPicker() {
  const onChange = vi.fn();
  const { user } = render(
    <LabelEditor
      labels={[]}
      onChange={onChange}
      projectId="project-1"
      canManage
    />,
  );
  await user.click(screen.getByRole('button', { name: 'labels.add' }));
  return {
    input: screen.getByRole('textbox', { name: 'labels.add' }),
    onChange,
  };
}

describe.each(['pick', 'create'] as const)('LabelEditor %s IME', (action) => {
  const unfinished = action === 'pick' ? '日' : 'にほ';
  const completed = action === 'pick' ? '日本語' : '新規';

  it.each([
    'composition events',
    'native isComposing',
    'Safari keyCode 229',
  ] as const)(
    'does not act on %s Enter, then commits once after conversion',
    async (mode) => {
      const { input, onChange } = await openPicker();
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: unfinished } });
      if (mode !== 'composition events') fireEvent.compositionEnd(input);
      const candidateAccepted = fireEvent.keyDown(input, {
        key: 'Enter',
        code: 'Enter',
        isComposing: mode === 'native isComposing',
        keyCode: mode === 'Safari keyCode 229' ? 229 : 13,
      });
      expect(mocks.create).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(candidateAccepted).toBe(true);
      expect(input).toHaveValue(unfinished);
      if (mode === 'composition events') fireEvent.compositionEnd(input);
      fireEvent.change(input, { target: { value: completed } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13 });
      await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
      expect(onChange).toHaveBeenCalledWith([completed]);
      if (action === 'create') {
        expect(mocks.create).toHaveBeenCalledOnce();
        expect(mocks.create).toHaveBeenCalledWith({
          projectId: 'project-1',
          name: completed,
        });
      } else expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it('keeps the picker open on composing Escape, then accepts regular Enter', async () => {
    const { input, onChange } = await openPicker();
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: unfinished } });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(unfinished);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: completed } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  });

  it.each([false, true])(
    'preserves ordinary Enter with shiftKey=%s',
    async (shiftKey) => {
      const { input, onChange } = await openPicker();
      fireEvent.change(input, { target: { value: completed } });
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 13, shiftKey });
      await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
      expect(onChange).toHaveBeenCalledWith([completed]);
      expect(mocks.create).toHaveBeenCalledTimes(action === 'create' ? 1 : 0);
    },
  );
});

it('ordinary Escape still dismisses the picker without creating or picking', async () => {
  const { input, onChange } = await openPicker();
  fireEvent.change(input, { target: { value: 'Draft' } });
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 27 });
  await waitFor(() =>
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument(),
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
