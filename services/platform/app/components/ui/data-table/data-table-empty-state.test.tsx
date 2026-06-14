import { Inbox, Plus } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

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

  describe('action CTA', () => {
    it('renders the action button and fires onClick', async () => {
      const onClick = vi.fn();
      const { user } = render(
        <DataTableEmptyState
          icon={Inbox}
          title="No agents yet"
          description="Create your first agent."
          action={{ label: 'Create agent', icon: Plus, onClick }}
        />,
      );
      const button = screen.getByRole('button', { name: 'Create agent' });
      await user.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('renders no button when no action is provided', () => {
      render(<DataTableEmptyState title="No items" />);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
