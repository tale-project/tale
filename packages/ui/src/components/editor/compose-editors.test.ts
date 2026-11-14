import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useComposedEditor } from './compose-editors';
import type { EditorController } from './types';

function section(overrides: Partial<EditorController> = {}): EditorController {
  return {
    isDirty: false,
    isSaving: false,
    isValid: true,
    isLoading: false,
    dirtyKeys: new Set<string>(),
    save: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn(),
    ...overrides,
  };
}

describe('useComposedEditor — invalidReason', () => {
  it('passes on the reason of the dirty section that blocks the save', () => {
    const clean = section({ isValid: false, invalidReason: 'clean reason' });
    const blocked = section({
      isDirty: true,
      isValid: false,
      invalidReason: 'blocked reason',
    });
    const { result } = renderHook(() => useComposedEditor(clean, blocked));
    expect(result.current.isValid).toBe(false);
    expect(result.current.invalidReason).toBe('blocked reason');
  });

  it('supplies no reason when every dirty section is valid', () => {
    const { result } = renderHook(() =>
      useComposedEditor(
        section({ isDirty: true, invalidReason: 'stale reason' }),
        section({ isValid: false, invalidReason: 'clean reason' }),
      ),
    );
    expect(result.current.isValid).toBe(true);
    expect(result.current.invalidReason).toBeUndefined();
  });

  it('skips a blocking section that has no reason to show', () => {
    const { result } = renderHook(() =>
      useComposedEditor(
        section({ isDirty: true, isValid: false }),
        section({
          isDirty: true,
          isValid: false,
          invalidReason: 'second reason',
        }),
      ),
    );
    expect(result.current.invalidReason).toBe('second reason');
  });
});
