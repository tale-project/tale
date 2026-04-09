import React from 'react';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DataTableActionMenu } from './data-table-action-menu';

vi.mock('@tanstack/react-router', () => ({
  Link: React.forwardRef(
    (
      props: { to: string; children: React.ReactNode },
      ref: React.Ref<HTMLAnchorElement>,
    ) => (
      <a ref={ref} href={props.to}>
        {props.children}
      </a>
    ),
  ),
}));

describe('DataTableActionMenu', () => {
  describe('accessibility', () => {
    it('passes axe audit as simple button', async () => {
      const { container } = render(
        <DataTableActionMenu label="Create" onClick={vi.fn()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit as link button', async () => {
      const { container } = render(
        <DataTableActionMenu label="View All" href="/items" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with dropdown menu items', async () => {
      const { container } = render(
        <DataTableActionMenu
          label="Actions"
          menuItems={[
            { label: 'Import', onClick: vi.fn() },
            { label: 'Export', onClick: vi.fn() },
          ]}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
