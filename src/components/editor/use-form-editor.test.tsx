// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import { EditorSaveCancelledError } from './types';
import { useFormEditor } from './use-form-editor';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock('@tale/ui/use-toast', () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  toastMock.mockReset();
});

interface Form {
  name: string;
  color: string;
}

const schema = z.object({
  name: z.string().min(1),
  color: z.string(),
});

function mount(
  initialData: Form | undefined,
  save: (v: Form) => Promise<void> = vi.fn().mockResolvedValue(undefined),
) {
  return renderHook(
    ({ data }: { data: Form | undefined }) =>
      useFormEditor<Form>({ data, schema, save }),
    { initialProps: { data: initialData } },
  );
}

describe('useFormEditor', () => {
  it('is loading + not dirty while data is undefined, then clean once data arrives', () => {
    const { result, rerender } = mount(undefined);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isDirty).toBe(false);

    rerender({ data: { name: 'A', color: '#FF0000' } });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it('flips dirty for a custom control set via setValue+shouldDirty, and clears on revert', () => {
    const { result } = mount({ name: 'A', color: '#FF0000' });

    act(() =>
      result.current.form.setValue('color', '#00FF00', { shouldDirty: true }),
    );
    expect(result.current.isDirty).toBe(true);

    act(() =>
      result.current.form.setValue('color', '#FF0000', { shouldDirty: true }),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it('adopts saved values as the new baseline (isDirty false after save)', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = mount({ name: 'A', color: '#FF0000' }, save);

    act(() => result.current.form.setValue('name', 'B', { shouldDirty: true }));
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      await result.current.save();
    });

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'B', color: '#FF0000' }),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it('keeps isDirty true when save throws (so the user can retry)', async () => {
    const save = vi.fn().mockRejectedValue(new Error('boom'));
    const { result } = mount({ name: 'A', color: '#FF0000' }, save);

    act(() => result.current.form.setValue('name', 'B', { shouldDirty: true }));

    await act(async () => {
      await expect(result.current.save()).rejects.toThrow('boom');
    });
    expect(result.current.isDirty).toBe(true);
  });

  it('silently resyncs to upstream data while clean', () => {
    const { result, rerender } = mount({ name: 'A', color: '#FF0000' });

    rerender({ data: { name: 'A2', color: '#FF0000' } });
    expect(result.current.hasRemoteUpdate).toBe(false);
    expect(result.current.form.getValues('name')).toBe('A2');
  });

  it('flags a remote update (and preserves edits) when data changes while dirty', () => {
    const { result, rerender } = mount({ name: 'A', color: '#FF0000' });

    act(() =>
      result.current.form.setValue('name', 'edited', { shouldDirty: true }),
    );
    rerender({ data: { name: 'server', color: '#FF0000' } });

    expect(result.current.hasRemoteUpdate).toBe(true);
    expect(result.current.form.getValues('name')).toBe('edited');
    expect(result.current.isDirty).toBe(true);
  });

  it('notifies onReset after the baseline is restored, so state outside the form can follow', () => {
    const onReset = vi.fn();
    const { result } = renderHook(() =>
      useFormEditor<Form>({
        data: { name: 'A', color: '#FF0000' },
        schema,
        save: vi.fn().mockResolvedValue(undefined),
        onReset,
      }),
    );
    act(() => result.current.form.setValue('name', 'B', { shouldDirty: true }));
    expect(onReset).not.toHaveBeenCalled();
    act(() => result.current.reset());
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(result.current.form.getValues('name')).toBe('A');
  });

  it('reset reverts to the current data baseline', () => {
    const { result } = mount({ name: 'A', color: '#FF0000' });
    act(() => result.current.form.setValue('name', 'B', { shouldDirty: true }));
    act(() => result.current.reset());
    expect(result.current.form.getValues('name')).toBe('A');
    expect(result.current.isDirty).toBe(false);
  });

  it('keeps stable save/reset identities across data churn (active-editor staleness fix)', () => {
    const { result, rerender } = mount({ name: 'A', color: '#FF0000' });
    const save0 = result.current.save;
    const reset0 = result.current.reset;

    rerender({ data: { name: 'A2', color: '#0000FF' } });
    expect(result.current.save).toBe(save0);
    expect(result.current.reset).toBe(reset0);
  });

  it('seeds defined defaultValues while data is still loading (controlled from first render)', () => {
    const { result, rerender } = renderHook(
      ({ data }: { data: Form | undefined }) =>
        useFormEditor<Form>({
          data,
          defaultValues: { name: '', color: '' },
          schema,
          save: vi.fn().mockResolvedValue(undefined),
        }),
      { initialProps: { data: undefined as Form | undefined } },
    );

    // Loading, but the controlled fields already read defined values rather
    // than undefined — no uncontrolled→controlled churn when data arrives.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.form.getValues('name')).toBe('');
    expect(result.current.form.getValues('color')).toBe('');
    expect(result.current.isDirty).toBe(false);

    rerender({ data: { name: 'A', color: '#FF0000' } });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.form.getValues('name')).toBe('A');
    expect(result.current.isDirty).toBe(false);
  });

  it('reports isValid:false for schema-invalid input', async () => {
    const { result } = mount({ name: 'A', color: '#FF0000' });
    act(() => result.current.form.setValue('name', '', { shouldDirty: true }));
    await waitFor(() => expect(result.current.isValid).toBe(false));
  });

  // Regression: a native `<form onSubmit={editor.submit}>` must run the save AND
  // reset the dirty baseline. The earlier wiring used the raw
  // `handleSubmit(save)`, which saved but never reset — so the Save button (a
  // `type="submit"` form button) stayed active and the navigation blocker fired
  // after a successful save. The existing tests only called `editor.save()`
  // directly, so they never exercised this path.
  it('clears isDirty after a native form submit through editor.submit', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const holder: { current: ReturnType<typeof useFormEditor<Form>> | null } = {
      current: null,
    };

    function Harness() {
      const editor = useFormEditor<Form>({
        data: { name: 'A', color: '#FF0000' },
        schema,
        save,
      });
      holder.current = editor;
      return (
        <form onSubmit={editor.submit}>
          <input aria-label="name" {...editor.form.register('name')} />
          <button type="submit">Save</button>
        </form>
      );
    }

    const { container } = render(<Harness />);

    fireEvent.change(screen.getByLabelText('name'), {
      target: { value: 'B' },
    });
    await waitFor(() => expect(holder.current?.isDirty).toBe(true));

    // Fire the native submit (what clicking the `type="submit"` button does).
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'B' })),
    );
    await waitFor(() => expect(holder.current?.isDirty).toBe(false));
  });

  describe('a native submit that fails', () => {
    function submitName(
      name: string,
      save: (values: Form) => Promise<void>,
      mapServerError?: (
        err: unknown,
      ) => ReadonlyArray<{ path: string; message: string }> | null,
    ) {
      const holder: {
        current: ReturnType<typeof useFormEditor<Form>> | null;
      } = { current: null };
      function Harness() {
        const editor = useFormEditor<Form>({
          data: { name: 'A', color: '#FF0000' },
          schema,
          save,
          mapServerError,
        });
        holder.current = editor;
        return (
          <form onSubmit={editor.submit}>
            <input aria-label="name" {...editor.form.register('name')} />
            <button type="submit">Save</button>
          </form>
        );
      }
      const { container } = render(<Harness />);
      fireEvent.change(screen.getByLabelText('name'), {
        target: { value: name },
      });
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
      return holder;
    }

    // The native submit (Enter, a `type="submit"` Save) bypasses
    // EditorActions, and the write under `save` keeps its own toast quiet so
    // the cluster's is the only one: this path used to only log the failure,
    // so a refused save said nothing at all.
    it('reports a server failure with the one toast EditorActions raises', async () => {
      const save = vi.fn().mockRejectedValue(new Error('The name is taken.'));
      const holder = submitName('B', save);

      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
      expect(toastMock).toHaveBeenCalledWith({
        title: 'actions.save',
        description: 'The name is taken.',
        variant: 'destructive',
      });
      expect(holder.current?.isDirty).toBe(true);
    });

    it("never shows a structured error's payload", async () => {
      const refusal = Object.assign(new Error('{"code":"FORBIDDEN"}'), {
        data: { code: 'FORBIDDEN' },
      });
      submitName('B', vi.fn().mockRejectedValue(refusal));

      await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'errors.somethingWentWrong' }),
      );
    });

    it('stays quiet on a validation failure, shown under its field', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const holder = submitName('', save);

      await waitFor(() =>
        expect(holder.current?.form.formState.errors.name).toBeDefined(),
      );
      expect(save).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
    });

    it('stays quiet when the save was cancelled', async () => {
      const save = vi.fn().mockRejectedValue(new EditorSaveCancelledError());
      submitName('B', save);

      await waitFor(() => expect(save).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(toastMock).not.toHaveBeenCalled();
    });

    it('stays quiet when the failure maps onto a field', async () => {
      const save = vi.fn().mockRejectedValue(new Error('taken'));
      const holder = submitName('B', save, () => [
        { path: 'name', message: 'That name is taken.' },
      ]);

      await waitFor(() =>
        expect(holder.current?.form.formState.errors.name?.message).toBe(
          'That name is taken.',
        ),
      );
      expect(toastMock).not.toHaveBeenCalled();
    });
  });
});
