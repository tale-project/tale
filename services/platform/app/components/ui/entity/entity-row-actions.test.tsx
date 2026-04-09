import { Eye, Pencil, Trash2 } from 'lucide-react';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { EntityRowActions } from './entity-row-actions';

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
