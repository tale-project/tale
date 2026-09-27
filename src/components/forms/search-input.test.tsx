import { Skeletonize } from '@tale/ui/skeleton-context';
import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { FIELD_LAYOUT_ROW } from './field-shell';
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

    it('renders optional indicator', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          required={false}
        />,
      );
      expect(screen.getByText(/optional/i)).toBeInTheDocument();
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

  describe('default chrome', () => {
    // The input is natively readOnly until focus purely to suppress
    // password-manager autofill; that trick must not select Input's
    // borderless read-only display variant (#2131) — a search box is
    // always an editable control and keeps the bordered default chrome.
    it('keeps the bordered default variant while readOnly-until-focus', () => {
      render(
        <SearchInput value="" onChange={vi.fn()} placeholder="Search..." />,
      );
      const input = screen.getByPlaceholderText('Search...');
      expect(input).toHaveAttribute('readonly');
      expect(input).toHaveClass('bg-input');
      expect(input).not.toHaveClass('bg-transparent');
    });

    // A search box is a toolbar control, so its width is the caller's: on a
    // settings surface the field frame used to pin it to the 20rem control
    // column, which left a 4rem dead gap between the box and the filter button
    // beside it.
    it('never takes the settings control column width', () => {
      const { container } = render(
        <div {...FIELD_LAYOUT_ROW}>
          <SearchInput
            value=""
            onChange={vi.fn()}
            placeholder="Search..."
            wrapperClassName="w-[18rem]"
          />
        </div>,
      );

      const column = screen
        .getByPlaceholderText('Search...')
        .closest('div.flex.flex-col');
      expect(column).toHaveClass('in-data-[field-layout=row]:sm:w-full');
      expect(column).not.toHaveClass('in-data-[field-layout=row]:sm:w-80');
      expect(container.querySelector('.w-\\[18rem\\]')).toBeInTheDocument();
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

    it('falls back to placeholder as accessible name when no label', () => {
      render(
        <SearchInput value="" onChange={vi.fn()} placeholder="Search agents" />,
      );
      // Placeholder is not an accessible name on its own, so the input is
      // exposed via aria-label derived from the placeholder (WCAG 4.1.2).
      expect(screen.getByRole('textbox')).toHaveAttribute(
        'aria-label',
        'Search agents',
      );
      expect(screen.getByLabelText('Search agents')).toBeInTheDocument();
    });

    it('prefers an explicit aria-label over the placeholder', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          placeholder="Search agents"
          aria-label="Filter agents"
        />,
      );
      expect(screen.getByRole('textbox')).toHaveAttribute(
        'aria-label',
        'Filter agents',
      );
    });

    it('does not duplicate the accessible name when a visible label exists', () => {
      render(
        <SearchInput
          value=""
          onChange={vi.fn()}
          label="Search"
          placeholder="Search agents"
        />,
      );
      // A visible <label for> already names the input; avoid a redundant
      // aria-label that would override it.
      expect(
        screen.getByLabelText('Search', { exact: false }),
      ).not.toHaveAttribute('aria-label');
    });

    it('passes axe audit with placeholder-only accessible name', async () => {
      const { container } = render(
        <SearchInput value="" onChange={vi.fn()} placeholder="Search agents" />,
      );
      await checkAccessibility(container);
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
