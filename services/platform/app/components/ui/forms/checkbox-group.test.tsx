import { describe, it, expect, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { Checkbox } from './checkbox';
import { CheckboxGroup } from './checkbox-group';

describe('CheckboxGroup', () => {
  describe('rendering', () => {
    it('renders with role="group"', () => {
      render(
        <CheckboxGroup options={[{ value: 'a', label: 'A' }]} value={[]} />,
      );
      expect(screen.getByRole('group')).toBeInTheDocument();
    });

    it('renders all options as checkboxes', () => {
      render(
        <CheckboxGroup
          value={[]}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'c', label: 'C' },
          ]}
        />,
      );
      expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    });

    it('renders label', () => {
      render(
        <CheckboxGroup
          label="Pick items"
          value={[]}
          options={[{ value: 'a', label: 'A' }]}
        />,
      );
      expect(screen.getByText('Pick items')).toBeInTheDocument();
    });

    it('renders group description', () => {
      render(
        <CheckboxGroup
          label="Items"
          description="Select multiple"
          value={[]}
          options={[{ value: 'a', label: 'A' }]}
        />,
      );
      expect(screen.getByText('Select multiple')).toBeInTheDocument();
    });

    it('renders option descriptions', () => {
      render(
        <CheckboxGroup
          value={[]}
          options={[
            { value: 'a', label: 'A', description: 'First option' },
            { value: 'b', label: 'B', description: 'Second option' },
          ]}
        />,
      );
      expect(screen.getByText('First option')).toBeInTheDocument();
      expect(screen.getByText('Second option')).toBeInTheDocument();
    });

    it('checks options matching value array', () => {
      render(
        <CheckboxGroup
          value={['a', 'c']}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'c', label: 'C' },
          ]}
        />,
      );
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes[0]).toHaveAttribute('data-state', 'checked');
      expect(checkboxes[1]).toHaveAttribute('data-state', 'unchecked');
      expect(checkboxes[2]).toHaveAttribute('data-state', 'checked');
    });

    it('renders children when no options provided', () => {
      render(
        <CheckboxGroup label="Custom">
          <Checkbox label="Item 1" />
          <Checkbox label="Item 2" />
        </CheckboxGroup>,
      );
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
      expect(screen.getByText('Item 1')).toBeInTheDocument();
    });

    it('renders 2-column grid by default', () => {
      const { container } = render(
        <CheckboxGroup
          value={[]}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />,
      );
      const grid = container.querySelector('.grid');
      expect(grid).toHaveClass('grid-cols-2');
    });

    it('renders single column when columns={1}', () => {
      const { container } = render(
        <CheckboxGroup
          columns={1}
          value={[]}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />,
      );
      const grid = container.querySelector('.grid');
      expect(grid).not.toHaveClass('grid-cols-2');
    });
  });

  describe('interactions', () => {
    it('adds value when unchecked option is clicked', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <CheckboxGroup
          value={['a']}
          onValueChange={handleChange}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />,
      );

      await user.click(screen.getByText('B'));
      expect(handleChange).toHaveBeenCalledWith(['a', 'b']);
    });

    it('removes value when checked option is clicked', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <CheckboxGroup
          value={['a', 'b']}
          onValueChange={handleChange}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />,
      );

      await user.click(screen.getByText('A'));
      expect(handleChange).toHaveBeenCalledWith(['b']);
    });

    it('does not call onValueChange for disabled option', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <CheckboxGroup
          value={[]}
          onValueChange={handleChange}
          options={[{ value: 'a', label: 'A', disabled: true }]}
        />,
      );

      await user.click(screen.getByText('A'));
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('does not call onValueChange when group is disabled', async () => {
      const handleChange = vi.fn();
      const { user } = render(
        <CheckboxGroup
          value={[]}
          onValueChange={handleChange}
          disabled
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />,
      );

      await user.click(screen.getByText('A'));
      expect(handleChange).not.toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CheckboxGroup
          label="Permissions"
          value={['read']}
          options={[
            { value: 'read', label: 'Read' },
            { value: 'write', label: 'Write' },
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with descriptions', async () => {
      const { container } = render(
        <CheckboxGroup
          label="Tools"
          description="Select tools"
          value={[]}
          options={[
            { value: 'a', label: 'A', description: 'First' },
            { value: 'b', label: 'B', description: 'Second' },
          ]}
        />,
      );
      await checkAccessibility(container);
    });

    it('sets aria-labelledby when label is provided', () => {
      render(
        <CheckboxGroup
          label="Pick items"
          value={[]}
          options={[{ value: 'a', label: 'A' }]}
        />,
      );
      expect(screen.getByRole('group')).toHaveAttribute('aria-labelledby');
    });

    it('sets aria-describedby when description is provided', () => {
      render(
        <CheckboxGroup
          label="Items"
          description="Helper text"
          value={[]}
          options={[{ value: 'a', label: 'A' }]}
        />,
      );
      expect(screen.getByRole('group')).toHaveAttribute('aria-describedby');
    });
  });
});
