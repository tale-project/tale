// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
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
});
