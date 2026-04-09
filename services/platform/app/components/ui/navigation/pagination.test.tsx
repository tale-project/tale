import React from 'react';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { Pagination } from './pagination';

const stableSearch = {};

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
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/dashboard/test-org/documents' }),
  useSearch: () => stableSearch,
}));

vi.mock('@/app/components/ui/forms/select', () => ({
  Select: (props: {
    value: string;
    onValueChange?: (v: string) => void;
    options?: { value: string; label: string }[];
    disabled?: boolean;
  }) => (
    <select
      value={props.value}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
        props.onValueChange?.(e.target.value)
      }
      disabled={props.disabled}
      aria-label="Page"
    >
      {props.options?.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

describe('Pagination', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Pagination currentPage={1} total={50} pageSize={10} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when empty', async () => {
      const { container } = render(
        <Pagination currentPage={1} total={0} pageSize={10} />,
      );
      await checkAccessibility(container);
    });
  });
});
