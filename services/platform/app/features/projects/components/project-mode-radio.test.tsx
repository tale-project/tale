import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen } from '@/tests/utils/render';

import {
  ProjectModeRadio,
  type ProjectModeRadioOption,
} from './project-mode-radio';

const OPTIONS: ProjectModeRadioOption[] = [
  {
    value: 'recommended',
    label: 'Recommended',
    description: 'Pin some to the top.',
  },
  {
    value: 'restricted',
    label: 'Restricted',
    description: 'Allowlist only.',
  },
];

describe('ProjectModeRadio', () => {
  it('renders the radio options with the expected labels', () => {
    render(
      <ProjectModeRadio
        value="recommended"
        onChange={vi.fn()}
        options={OPTIONS}
      />,
    );
    expect(screen.getByRole('radio', { name: /Recommended/ })).not.toBe(null);
    expect(screen.getByRole('radio', { name: /Restricted/ })).not.toBe(null);
  });

  it('selects the radio matching `value`', () => {
    render(
      <ProjectModeRadio
        value="recommended"
        onChange={vi.fn()}
        options={OPTIONS}
      />,
    );
    expect(screen.getByRole('radio', { name: /Recommended/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /Restricted/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('fires onChange with the new value when a different option is clicked', () => {
    const onChange = vi.fn();
    render(
      <ProjectModeRadio
        value="recommended"
        onChange={onChange}
        options={OPTIONS}
      />,
    );
    const restricted = screen.getByRole('radio', { name: /Restricted/ });
    fireEvent.click(restricted);
    expect(onChange).toHaveBeenCalledWith('restricted');
  });

  it('does not fire onChange when clicking the already-selected option', () => {
    const onChange = vi.fn();
    render(
      <ProjectModeRadio
        value="recommended"
        onChange={onChange}
        options={OPTIONS}
      />,
    );
    fireEvent.click(screen.getByRole('radio', { name: /Recommended/ }));
    // Radix RadioGroup only emits onValueChange when the value changes.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables every radio when disabled is true', () => {
    render(
      <ProjectModeRadio
        value="recommended"
        onChange={vi.fn()}
        options={OPTIONS}
        disabled
      />,
    );
    const radios = screen.getAllByRole('radio');
    for (const r of radios) expect(r).toBeDisabled();
  });

  it('groups the radios via role="radiogroup" and exposes the legend', () => {
    render(
      <ProjectModeRadio
        value="recommended"
        onChange={vi.fn()}
        options={OPTIONS}
        legend="Agent mode"
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Agent mode' })).not.toBe(
      null,
    );
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ProjectModeRadio
          value="recommended"
          onChange={vi.fn()}
          options={OPTIONS}
          legend="Agent mode"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when disabled', async () => {
      const { container } = render(
        <ProjectModeRadio
          value="restricted"
          onChange={vi.fn()}
          options={OPTIONS}
          legend="Agent mode"
          disabled
        />,
      );
      await checkAccessibility(container);
    });
  });
});
