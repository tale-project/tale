import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableFooter,
  TableCaption,
} from './table';

describe('Table', () => {
  // Header text sits on the `--muted` fill, where `--muted-foreground` is
  // 4.40:1 — under the 4.5:1 AA bar for 14px text (A11Y-A8). The header reads
  // its own token; jsdom cannot measure colour, so the class is the contract.
  it('paints header text with the table-header token, not muted-foreground', () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    const head = screen.getByRole('columnheader', { name: 'Name' });
    expect(head).toHaveClass('text-table-header-foreground');
    expect(head).not.toHaveClass('text-muted-foreground');
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Table>
          <TableCaption>A list of users</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>John Doe</TableCell>
              <TableCell>john@example.com</TableCell>
            </TableRow>
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Total: 1</TableCell>
            </TableRow>
          </TableFooter>
        </Table>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with sticky layout', async () => {
      const { container } = render(
        <Table stickyLayout>
          <TableHeader sticky>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>John Doe</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      await checkAccessibility(container);
    });
  });
});
