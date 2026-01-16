import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils/render';
import { checkAccessibility } from '@/test/utils/a11y';
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

    it('renders required indicator', () => {
      render(
        <Select options={options} label="Fruit" required placeholder="Select" />
      );
      expect(screen.getByText('*')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('opens dropdown on click', async () => {
      const { user } = render(
        <Select options={options} placeholder="Select fruit" />
      );

      await user.click(screen.getByRole('combobox'));

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });
    });

    it('selects option on click', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <Select
          options={options}
          placeholder="Select fruit"
          onValueChange={handleChange}
        />
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
        <Select options={options} placeholder="Select fruit" disabled />
      );

      await user.click(screen.getByRole('combobox'));

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Select options={options} label="Fruit" placeholder="Select" />
      );
      await checkAccessibility(container);
    });

    it('has aria-invalid when error', () => {
      render(<Select options={options} placeholder="Select" error />);
      expect(screen.getByRole('combobox')).toHaveAttribute(
        'aria-invalid',
        'true'
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
        />
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
        <Select options={optionsWithDisabled} placeholder="Select" />
      );

      await user.click(screen.getByRole('combobox'));

      await waitFor(() => {
        const disabledOption = screen.getByRole('option', { name: 'Option B' });
        expect(disabledOption).toHaveAttribute('data-disabled');
      });
    });
  });
});
