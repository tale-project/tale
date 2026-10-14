import { act, renderHook } from '@testing-library/react';
import { Eye, Pencil, Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { EntityRowActions, useEntityRowDialogs } from './entity-row-actions';

describe('EntityRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit with action items', async () => {
      const { container } = render(
        <EntityRowActions
          actions={[
            { key: 'view', label: 'View', icon: Eye, onClick: vi.fn() },
            { key: 'edit', label: 'Edit', icon: Pencil, onClick: vi.fn() },
            {
              key: 'delete',
              label: 'Delete',
              icon: Trash2,
              onClick: vi.fn(),
              destructive: true,
              separator: true,
            },
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with custom aria label', async () => {
      const { container } = render(
        <EntityRowActions
          ariaLabel="Actions for customer"
          actions={[
            { key: 'edit', label: 'Edit', icon: Pencil, onClick: vi.fn() },
          ]}
        />,
      );
      await checkAccessibility(container);
    });
  });
});

describe('useEntityRowDialogs', () => {
  // Every row of a long list carries its dialogs; mounting them closed cost
  // each row their forms, mutations and translations.
  it('mounts a dialog from its first open and keeps it after it closes', () => {
    const { result } = renderHook(() =>
      useEntityRowDialogs(['edit', 'delete']),
    );
    expect(result.current.mounted).toEqual({ edit: false, delete: false });

    act(() => result.current.open.edit());
    expect(result.current.isOpen.edit).toBe(true);
    expect(result.current.mounted).toEqual({ edit: true, delete: false });

    // Closed again, it stays mounted, so its exit animation can play.
    act(() => result.current.setOpen.edit(false));
    expect(result.current.isOpen.edit).toBe(false);
    expect(result.current.mounted.edit).toBe(true);

    act(() => result.current.setOpen.delete(true));
    expect(result.current.mounted).toEqual({ edit: true, delete: true });

    act(() => result.current.closeAll());
    expect(result.current.isOpen).toEqual({ edit: false, delete: false });
    expect(result.current.mounted).toEqual({ edit: true, delete: true });
  });

  it('keeps its handlers across renders', () => {
    const { result, rerender } = renderHook(() =>
      useEntityRowDialogs(['edit']),
    );
    const { open, setOpen } = result.current;
    act(() => result.current.open.edit());
    rerender();
    expect(result.current.open).toBe(open);
    expect(result.current.setOpen).toBe(setOpen);
  });
});
