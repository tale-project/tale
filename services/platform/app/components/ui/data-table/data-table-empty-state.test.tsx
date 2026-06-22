import { Inbox } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { DataTableEmptyState } from './data-table-empty-state';

describe('DataTableEmptyState', () => {
  describe('accessibility', () => {
    it('passes axe audit with title only', async () => {
      const { container } = render(
        <DataTableEmptyState title="No items found" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with icon and description', async () => {
      const { container } = render(
        <DataTableEmptyState
          icon={Inbox}
          title="No results"
          description="Try adjusting your search or filters."
        />,
      );
      await checkAccessibility(container);
    });
  });

  describe('button-less', () => {
    it('never renders a button — table empty states carry no CTA', () => {
      render(
        <DataTableEmptyState
          icon={Inbox}
          title="No agents yet"
          description="Create your first agent."
        />,
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
