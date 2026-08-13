import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { Select } from './select';

const options = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

describe('Select', () => {
  describe('rendering', () => {
    it('renders with placeholder', () => {
      render(<Select options={options} placeholder="Select fruit" />);
      expect(screen.getByRole('combobox')).toHaveTextContent('Select fruit');
    });

    it('renders with label', () => {
      render(<Select options={options} label="Fruit" placeholder="Select" />);
      expect(screen.getByText('Fruit')).toBeInTheDocument();
    });

    it('renders optional indicator', () => {
      render(
        <Select
          options={options}
          label="Fruit"
          required={false}
          placeholder="Select"
        />,
      );
      expect(screen.getByText(/optional/i)).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('opens dropdown on click', async () => {
      const { user } = render(
        <Select options={options} placeholder="Select fruit" />,
      );

      await user.click(screen.getByRole('combobox'));

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });
    });

    // Regression test for #1492: near the bottom of a short viewport the
    // dropdown must shrink to the space Radix measures instead of keeping a
    // fixed max-height, otherwise its first option ("End workflow" in the
    // workflow next-step selector) gets clipped behind the scroll buttons.
    it('caps the dropdown height to the available viewport space', async () => {
      const { user } = render(
        <Select options={options} placeholder="Select fruit" />,
      );

      await user.click(screen.getByRole('combobox'));
      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const heightAware = document.querySelector(
        '[class*="radix-select-content-available-height"]',
      );
      expect(heightAware).not.toBeNull();
    });

    it('selects option on click', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Select
          options={options}
          placeholder="Select fruit"
          onValueChange={handleChange}
        />,
      );

      await user.click(screen.getByRole('combobox'));
      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('option', { name: 'Apple' }));
      expect(handleChange).toHaveBeenCalledWith('apple');
    });

    it('does not open when disabled', async () => {
      const { user } = render(
        <Select options={options} placeholder="Select fruit" disabled />,
      );

      await user.click(screen.getByRole('combobox'));

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Select options={options} label="Fruit" placeholder="Select" />,
      );
      await checkAccessibility(container);
    });

    it('has aria-invalid when error', () => {
      render(<Select options={options} placeholder="Select" error />);
      expect(screen.getByRole('combobox')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
    });

    it('shows error styling when error prop is true', () => {
      render(<Select options={options} placeholder="Select" error />);
      const trigger = screen.getByRole('combobox');
      expect(trigger.className).toContain('border-destructive');
    });
  });

  describe('default value', () => {
    it('shows default value', () => {
      render(
        <Select
          options={options}
          placeholder="Select fruit"
          defaultValue="banana"
        />,
      );
      expect(screen.getByRole('combobox')).toHaveTextContent('Banana');
    });
  });

  describe('controlled value', () => {
    it('shows controlled value', () => {
      render(
        <Select
          options={options}
          placeholder="Select fruit"
          value="cherry"
          onValueChange={() => {}}
        />,
      );
      expect(screen.getByRole('combobox')).toHaveTextContent('Cherry');
    });

    it('updates displayed value when controlled value changes', () => {
      const { rerender } = render(
        <Select
          options={options}
          placeholder="Select fruit"
          value="apple"
          onValueChange={() => {}}
        />,
      );
      expect(screen.getByRole('combobox')).toHaveTextContent('Apple');

      rerender(
        <Select
          options={options}
          placeholder="Select fruit"
          value="banana"
          onValueChange={() => {}}
        />,
      );
      expect(screen.getByRole('combobox')).toHaveTextContent('Banana');
    });
  });

  describe('disabled options', () => {
    it('renders disabled option', async () => {
      const optionsWithDisabled = [
        { value: 'a', label: 'Option A' },
        { value: 'b', label: 'Option B', disabled: true },
      ];

      const { user } = render(
        <Select options={optionsWithDisabled} placeholder="Select" />,
      );

      await user.click(screen.getByRole('combobox'));

      await waitFor(() => {
        const disabledOption = screen.getByRole('option', { name: 'Option B' });
        expect(disabledOption).toHaveAttribute('data-disabled');
      });
    });
  });

  describe('empty options', () => {
    // An empty dropdown never renders as a silent dead control: it disables
    // itself and explains — in a tooltip reachable by hover AND keyboard —
    // what creates the first option.
    it('renders an aria-disabled stand-in carrying the placeholder', () => {
      render(
        <Select aria-label="Fruit" options={[]} placeholder="Select fruit" />,
      );
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      const standIn = screen.getByRole('button', { name: 'Fruit' });
      expect(standIn).toHaveAttribute('aria-disabled', 'true');
      expect(standIn).toHaveTextContent('Select fruit');
    });

    it('is keyboard-reachable and describes why it is disabled', async () => {
      const { user } = render(
        <Select aria-label="Fruit" options={[]} placeholder="Select fruit" />,
      );
      // aria-disabled (not DOM `disabled`) keeps it focusable, so the reason
      // is reachable without a mouse.
      await user.tab();
      const standIn = screen.getByRole('button', { name: 'Fruit' });
      expect(standIn).toHaveFocus();
      expect(standIn).toHaveAccessibleDescription('Nothing to choose yet.');
    });

    it('prefers a caller-supplied emptyHint over the generic one', () => {
      render(
        <Select
          aria-label="Provider"
          options={[]}
          placeholder="Choose a provider"
          emptyHint="Add an AI provider first."
        />,
      );
      expect(
        screen.getByRole('button', { name: 'Provider' }),
      ).toHaveAccessibleDescription('Add an AI provider first.');
      expect(screen.queryByText('Nothing to choose yet.')).toBeNull();
    });

    it('passes axe audit while empty', async () => {
      const { container } = render(
        <Select options={[]} label="Fruit" placeholder="Select" />,
      );
      await checkAccessibility(container);
    });
  });
});
