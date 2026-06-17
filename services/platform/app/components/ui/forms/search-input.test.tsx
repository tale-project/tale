import { Skeletonize } from '@tale/ui/skeleton-context';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { SearchInput } from './search-input';

describe('SearchInput', () => {
  describe('rendering', () => {
    it('renders with placeholder', () => {
      render(
        <SearchInput value="" onChange={vi.fn()} placeholder="Search..." />,
      );
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });

    it('renders with label', () => {
      render(<SearchInput value="" onChange={vi.fn()} label="Search" />);
      expect(
        screen.getByLabelText('Search', { exact: false }),
      ).toBeInTheDocument();
    });

    it('renders required indicator', () => {
      render(
        <SearchInput value="" onChange={vi.fn()} label="Search" required />,
      );
      expect(screen.getByText('*')).toBeInTheDocument();
    });

    it('renders description', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          description="Search by name or email"
        />,
      );
      expect(screen.getByText('Search by name or email')).toBeInTheDocument();
    });

    it('renders error message', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          errorMessage="Search term is required"
        />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Search term is required',
      );
    });

    it('renders search icon', () => {
      const { container } = render(
        <SearchInput value="" onChange={vi.fn()} placeholder="Search..." />,
      );
      const icon = container.querySelector('[aria-hidden="true"]');
      expect(icon).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onChange when typing', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <SearchInput
          value=""
          onChange={handleChange}
          placeholder="Search..."
        />,
      );

      await user.type(screen.getByPlaceholderText('Search...'), 'hello');
      expect(handleChange).toHaveBeenCalled();
    });

    it('does not allow input when disabled', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <SearchInput
          value=""
          onChange={handleChange}
          placeholder="Search..."
          disabled
        />,
      );

      const input = screen.getByPlaceholderText('Search...');
      await user.type(input, 'hello');
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <SearchInput value="" onChange={vi.fn()} label="Search" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with error', async () => {
      const { container } = render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          errorMessage="Required"
        />,
      );
      await checkAccessibility(container);
    });

    it('is focusable', () => {
      render(<SearchInput value="" onChange={vi.fn()} label="Search" />);
      const input = screen.getByLabelText('Search', { exact: false });
      expectFocusable(input);
    });

    it('has aria-invalid when error', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          errorMessage="Invalid"
        />,
      );
      const input = screen.getByLabelText('Search', { exact: false });
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });

    it('has aria-describedby linked to error', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          id="search"
          errorMessage="Invalid"
        />,
      );
      const input = screen.getByLabelText('Search', { exact: false });
      const error = screen.getByRole('alert');
      expect(input).toHaveAttribute('aria-describedby', error.id);
    });

    it('error message has role alert', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          errorMessage="Invalid"
        />,
      );
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('label is associated with input', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          id="search-input"
        />,
      );
      const input = screen.getByLabelText('Search', { exact: false });
      expect(input).toHaveAttribute('id', 'search-input');
    });
  });

  describe('error animation', () => {
    it('applies shake class on error', async () => {
      const { rerender } = render(
        <SearchInput value="" onChange={vi.fn()} label="Search" />,
      );

      rerender(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          errorMessage="Invalid"
        />,
      );

      await waitFor(() => {
        expect(screen.getByLabelText('Search', { exact: false })).toHaveClass(
          'animate-shake',
        );
      });
    });
  });

  describe('skeleton mode', () => {
    it('masks the input (composed Input) while loading', () => {
      render(
        <Skeletonize loading>
          <SearchInput value="" onChange={vi.fn()} placeholder="Search..." />
        </Skeletonize>,
      );
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('keeps the static label real while loading', () => {
      render(
        <Skeletonize loading>
          <SearchInput value="" onChange={vi.fn()} label="Search" />
        </Skeletonize>,
      );
      expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('renders the real input when not loading', () => {
      render(
        <Skeletonize loading={false}>
          <SearchInput value="" onChange={vi.fn()} placeholder="Search..." />
        </Skeletonize>,
      );
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    });
  });
});
