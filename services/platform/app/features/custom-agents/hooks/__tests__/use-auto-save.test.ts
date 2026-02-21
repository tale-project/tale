import type { Mock } from 'vitest';

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useAutoSave } from '../use-auto-save';

interface TestData {
  value: string;
}

type SaveFn = ((data: TestData) => Promise<void>) & Mock;

describe('useAutoSave', () => {
  let onSave: SaveFn;

  beforeEach(() => {
    vi.useFakeTimers();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- vitest mock typing
    onSave = vi.fn().mockResolvedValue(undefined) as SaveFn;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with idle status', () => {
    const { result } = renderHook(() =>
      useAutoSave({
        data: { value: 'initial' },
        onSave,
      }),
    );

    expect(result.current.status).toBe('idle');
  });

  it('skips the initial value and does not save', async () => {
    renderHook(() =>
      useAutoSave({
        data: { value: 'initial' },
        onSave,
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves after debounce delay when data changes', async () => {
    const { result, rerender } = renderHook(
      (props: { data: { value: string } }) =>
        useAutoSave({ data: props.data, onSave }),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'changed' } });

    expect(result.current.status).toBe('saving');
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(onSave).toHaveBeenCalledWith({ value: 'changed' });
    expect(result.current.status).toBe('saved');
  });

  it('debounces rapid changes and only saves the last value', async () => {
    const { rerender } = renderHook(
      (props: { data: { value: string } }) =>
        useAutoSave({ data: props.data, onSave }),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'a' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    rerender({ data: { value: 'ab' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    rerender({ data: { value: 'abc' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ value: 'abc' });
  });

  it('saves when data differs from last saved value, skips when unchanged', async () => {
    const { rerender } = renderHook(
      (props: { data: { value: string } }) =>
        useAutoSave({ data: props.data, onSave }),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'changed' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(onSave).toHaveBeenCalledTimes(1);

    rerender({ data: { value: 'initial' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(onSave).toHaveBeenCalledTimes(2);

    rerender({ data: { value: 'initial' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('sets status to error when save fails', async () => {
    onSave.mockRejectedValueOnce(new Error('fail'));

    const { result, rerender } = renderHook(
      (props: { data: { value: string } }) =>
        useAutoSave({ data: props.data, onSave }),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'changed' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(result.current.status).toBe('error');
  });

  it('does not save when disabled', async () => {
    const { rerender } = renderHook(
      (props: { data: { value: string }; enabled: boolean }) =>
        useAutoSave({ data: props.data, onSave, enabled: props.enabled }),
      { initialProps: { data: { value: 'initial' }, enabled: false } },
    );

    rerender({ data: { value: 'changed' }, enabled: false });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('respects custom delay', async () => {
    const { rerender } = renderHook(
      (props: { data: { value: string } }) =>
        useAutoSave({ data: props.data, onSave, delay: 2000 }),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'changed' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('resets state with reset()', async () => {
    const { result, rerender } = renderHook(
      (props: { data: { value: string } }) =>
        useAutoSave({ data: props.data, onSave }),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'changed' } });
    await act(async () => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.status).toBe('saved');

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
  });

  it('saves pending data on unmount', async () => {
    const { rerender, unmount } = renderHook(
      (props: { data: { value: string } }) =>
        useAutoSave({ data: props.data, onSave }),
      { initialProps: { data: { value: 'initial' } } },
    );

    rerender({ data: { value: 'unsaved' } });
    unmount();

    expect(onSave).toHaveBeenCalledWith({ value: 'unsaved' });
  });

  describe('manual mode', () => {
    it('does not auto-save on data change', async () => {
      const { rerender } = renderHook(
        (props: { data: { value: string } }) =>
          useAutoSave({ data: props.data, onSave, mode: 'manual' }),
        { initialProps: { data: { value: 'initial' } } },
      );

      rerender({ data: { value: 'changed' } });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });

      expect(onSave).not.toHaveBeenCalled();
    });

    it('saves when save() is called without arguments', async () => {
      const { result, rerender } = renderHook(
        (props: { data: { value: string } }) =>
          useAutoSave({ data: props.data, onSave, mode: 'manual' }),
        { initialProps: { data: { value: 'initial' } } },
      );

      rerender({ data: { value: 'changed' } });

      await act(async () => {
        await result.current.save();
      });

      expect(onSave).toHaveBeenCalledWith({ value: 'changed' });
      expect(result.current.status).toBe('saved');
    });

    it('saves when save() is called with override data', async () => {
      const { result } = renderHook(
        (props: { data: { value: string } }) =>
          useAutoSave({ data: props.data, onSave, mode: 'manual' }),
        { initialProps: { data: { value: 'initial' } } },
      );

      await act(async () => {
        await result.current.save({ value: 'override' });
      });

      expect(onSave).toHaveBeenCalledWith({ value: 'override' });
      expect(result.current.status).toBe('saved');
    });

    it('does not save when data has not changed', async () => {
      const { result } = renderHook(
        (props: { data: { value: string } }) =>
          useAutoSave({ data: props.data, onSave, mode: 'manual' }),
        { initialProps: { data: { value: 'initial' } } },
      );

      await act(async () => {
        await result.current.save();
      });

      expect(onSave).not.toHaveBeenCalled();
    });

    it('still saves pending data on unmount', async () => {
      const { rerender, unmount } = renderHook(
        (props: { data: { value: string } }) =>
          useAutoSave({ data: props.data, onSave, mode: 'manual' }),
        { initialProps: { data: { value: 'initial' } } },
      );

      rerender({ data: { value: 'unsaved' } });
      unmount();

      expect(onSave).toHaveBeenCalledWith({ value: 'unsaved' });
    });

    it('sets status to error when save() fails', async () => {
      onSave.mockRejectedValueOnce(new Error('fail'));

      const { result, rerender } = renderHook(
        (props: { data: { value: string } }) =>
          useAutoSave({ data: props.data, onSave, mode: 'manual' }),
        { initialProps: { data: { value: 'initial' } } },
      );

      rerender({ data: { value: 'changed' } });

      await act(async () => {
        await result.current.save();
      });

      expect(result.current.status).toBe('error');
    });
  });
});
