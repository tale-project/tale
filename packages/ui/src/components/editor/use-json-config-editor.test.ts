// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useJsonConfigEditor } from './use-json-config-editor';

interface Cfg {
  a: number;
  b?: string;
  nested?: { x: number; y?: number };
}

describe('useJsonConfigEditor', () => {
  it('reports loading until initial resolves', () => {
    const { result, rerender } = renderHook(
      ({ initial }: { initial: Cfg | undefined }) =>
        useJsonConfigEditor<Cfg>({
          initial,
          save: vi.fn().mockResolvedValue(undefined),
        }),
      { initialProps: { initial: undefined as Cfg | undefined } },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isDirty).toBe(false);

    rerender({ initial: { a: 1 } });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isDirty).toBe(false);
  });

  it('ignores key-order shuffles and undefined leaves (structuralEqual)', () => {
    const { result } = renderHook(() =>
      useJsonConfigEditor<Cfg>({
        initial: { a: 1, nested: { x: 1, y: 2 } },
        save: vi.fn().mockResolvedValue(undefined),
      }),
    );
    act(() =>
      result.current.updateConfig({ nested: { y: 2, x: 1 }, b: undefined }),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it('becomes dirty on a real change and surfaces dirtyKeys', () => {
    const { result } = renderHook(() =>
      useJsonConfigEditor<Cfg>({
        initial: { a: 1, b: 'x' },
        save: vi.fn().mockResolvedValue(undefined),
      }),
    );
    act(() => result.current.updateConfig({ b: 'y' }));
    expect(result.current.isDirty).toBe(true);
    expect([...result.current.dirtyKeys]).toEqual(['b']);
  });

  it('normalizes the saved baseline so isDirty settles false after save', async () => {
    // Server strips empty `b`; the client `normalize` mirrors that so the
    // adopted baseline matches and the form is clean post-save.
    const save = vi.fn().mockResolvedValue(undefined);
    const normalize = (c: Cfg): Cfg => {
      const next = { ...c };
      if (next.b === '') delete next.b;
      return next;
    };
    const { result } = renderHook(() =>
      useJsonConfigEditor<Cfg>({ initial: { a: 1 }, save, normalize }),
    );

    act(() => result.current.updateConfig({ b: '' }));
    expect(result.current.isDirty).toBe(true);

    await act(async () => {
      await result.current.save();
    });
    expect(result.current.isDirty).toBe(false);
  });

  it('runs the prior-baseline history snapshot only after a successful save', async () => {
    const snapshot = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useJsonConfigEditor<Cfg>({
        initial: { a: 1 },
        save: vi.fn().mockResolvedValue(undefined),
        snapshotPriorBaseline: snapshot,
      }),
    );

    act(() => result.current.updateConfig({ a: 2 }));
    await act(async () => {
      await result.current.save();
    });
    expect(snapshot).toHaveBeenCalledWith({ a: 1 });
  });

  it('keeps a stable save identity across initial churn', () => {
    const { result, rerender } = renderHook(
      ({ initial }: { initial: Cfg }) =>
        useJsonConfigEditor<Cfg>({
          initial,
          save: vi.fn().mockResolvedValue(undefined),
        }),
      { initialProps: { initial: { a: 1 } } },
    );
    const save0 = result.current.save;
    rerender({ initial: { a: 2 } });
    expect(result.current.save).toBe(save0);
  });

  describe('schema', () => {
    // A minimal `JsonConfigSchema<Cfg>` stand-in — any Zod schema's
    // `safeParse` satisfies the same shape (#2665).
    const positiveASchema = {
      safeParse: (value: Cfg) =>
        value.a > 0 ? { success: true as const } : { success: false as const },
    };

    it('defaults to isValid:true with no schema (pre-existing behavior)', () => {
      const { result } = renderHook(() =>
        useJsonConfigEditor<Cfg>({
          initial: { a: -1 },
          save: vi.fn().mockResolvedValue(undefined),
        }),
      );
      expect(result.current.isValid).toBe(true);
    });

    it('reports isValid:true while loading even with a schema', () => {
      const { result } = renderHook(() =>
        useJsonConfigEditor<Cfg>({
          initial: undefined,
          save: vi.fn().mockResolvedValue(undefined),
          schema: positiveASchema,
        }),
      );
      expect(result.current.isValid).toBe(true);
    });

    it('reports isValid:false for schema-invalid config', () => {
      const { result } = renderHook(() =>
        useJsonConfigEditor<Cfg>({
          initial: { a: 1 },
          save: vi.fn().mockResolvedValue(undefined),
          schema: positiveASchema,
        }),
      );
      act(() => result.current.updateConfig({ a: -1 }));
      expect(result.current.isValid).toBe(false);
    });

    it('does not register a save path with the dirty blocker while invalid', async () => {
      const save = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() =>
        useJsonConfigEditor<Cfg>({
          initial: { a: 1 },
          save,
          schema: positiveASchema,
        }),
      );
      act(() => result.current.updateConfig({ a: -1 }));
      expect(result.current.isValid).toBe(false);
      // An invalid draft can only fail server-side — `save()` still works
      // directly (EditorActions gates the button on `isValid`), but nothing
      // here throws just because the config is invalid.
      await expect(result.current.save()).resolves.toBeUndefined();
      expect(save).toHaveBeenCalledWith({ a: -1 });
    });
  });
});
