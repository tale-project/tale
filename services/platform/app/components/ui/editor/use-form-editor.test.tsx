// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import { useFormEditor } from './use-form-editor';

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
});
