import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility, expectFocusable } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { RadioGroup, RadioGroupItem } from './radio-group';

describe('RadioGroup', () => {
  describe('rendering', () => {
    it('renders radio buttons from options', () => {
      render(
        <RadioGroup
          options={[
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ]}
        />,
      );
      expect(screen.getAllByRole('radio')).toHaveLength(2);
    });

    it('renders with label', () => {
      render(
        <RadioGroup label="Pick one" options={[{ value: 'a', label: 'A' }]} />,
      );
      expect(screen.getByText('Pick one')).toBeInTheDocument();
    });

    it('renders with group description', () => {
      render(
        <RadioGroup
          label="Pick one"
          description="Choose your preference"
          options={[{ value: 'a', label: 'A' }]}
        />,
      );
      expect(screen.getByText('Choose your preference')).toBeInTheDocument();
    });

    it('renders option descriptions', () => {
      render(
        <RadioGroup
          options={[
            { value: 'a', label: 'Option A', description: 'First option' },
            { value: 'b', label: 'Option B', description: 'Second option' },
          ]}
        />,
      );
      expect(screen.getByText('First option')).toBeInTheDocument();
      expect(screen.getByText('Second option')).toBeInTheDocument();
    });

    it('renders in single column by default', () => {
      render(
        <RadioGroup
          options={[
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ]}
        />,
      );
      const radioGroup = screen.getByRole('radiogroup');
      expect(radioGroup).not.toHaveClass('grid-cols-2');
    });

    it('renders in two columns when columns is 2', () => {
      render(
        <RadioGroup
          columns={2}
          options={[
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ]}
        />,
      );
      const radioGroup = screen.getByRole('radiogroup');
      expect(radioGroup).toHaveClass('grid-cols-2');
    });

    it('renders children instead of options', () => {
      render(
        <RadioGroup>
          <RadioGroupItem value="x" label="Custom X" />
          <RadioGroupItem value="y" label="Custom Y" />
        </RadioGroup>,
      );
      expect(screen.getAllByRole('radio')).toHaveLength(2);
      expect(screen.getByText('Custom X')).toBeInTheDocument();
    });

    it('renders RadioGroupItem with description', () => {
      render(
        <RadioGroup>
          <RadioGroupItem
            value="x"
            label="Custom"
            description="Item description"
          />
        </RadioGroup>,
      );
      expect(screen.getByText('Item description')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onValueChange when an option is selected', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <RadioGroup
          onValueChange={handleChange}
          options={[
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ]}
        />,
      );

      await user.click(screen.getByText('Option B'));
      expect(handleChange).toHaveBeenCalledWith('b');
    });

    it('does not select disabled option', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <RadioGroup
          onValueChange={handleChange}
          options={[
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B', disabled: true },
          ]}
        />,
      );

      await user.click(screen.getByText('Option B'));
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with options', async () => {
      const { container } = render(
        <RadioGroup
          label="Pick one"
          defaultValue="a"
          options={[
            { value: 'a', label: 'Option A' },
            { value: 'b', label: 'Option B' },
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with option descriptions', async () => {
      const { container } = render(
        <RadioGroup
          label="Pick one"
          defaultValue="a"
          options={[
            { value: 'a', label: 'A', description: 'First' },
            { value: 'b', label: 'B', description: 'Second' },
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('radio buttons are focusable', () => {
      render(
        <RadioGroup
          defaultValue="a"
          options={[{ value: 'a', label: 'Option A' }]}
        />,
      );
      const radio = screen.getByRole('radio');
      expectFocusable(radio);
    });

    it('sets aria-labelledby when label is provided', () => {
      render(
        <RadioGroup label="Pick one" options={[{ value: 'a', label: 'A' }]} />,
      );
      expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-labelledby');
    });

    it('sets aria-describedby when description is provided', () => {
      render(
        <RadioGroup
          label="Pick one"
          description="Helper text"
          options={[{ value: 'a', label: 'A' }]}
        />,
      );
      expect(screen.getByRole('radiogroup')).toHaveAttribute(
        'aria-describedby',
      );
    });
  });
});
