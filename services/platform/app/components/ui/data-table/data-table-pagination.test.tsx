import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DataTablePagination } from './data-table-pagination';

vi.mock('@/app/components/ui/forms/select', () => ({
  Select: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      aria-label="Page select"
    >
      {options.map((opt: { value: string; label: string }) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

describe('DataTablePagination', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <DataTablePagination
          currentPage={1}
          total={50}
          pageSize={10}
          onPageChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with page size selector', async () => {
      const { container } = render(
        <DataTablePagination
          currentPage={2}
          total={100}
          pageSize={20}
          onPageChange={vi.fn()}
          showPageSizeSelector
          onPageSizeChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
