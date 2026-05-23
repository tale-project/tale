import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

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
