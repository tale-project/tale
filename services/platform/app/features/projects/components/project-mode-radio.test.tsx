import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { fireEvent, render, screen } from '@/test/utils/render';

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
    const recommended = screen.getByRole('radio', {
      name: /Recommended/,
    }) as HTMLInputElement;
    expect(recommended.checked).toBe(true);
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
    // jsdom fires change only on transition; clicking the already-checked
    // radio does not produce a synthetic onChange.
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
    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    for (const r of radios) expect(r.disabled).toBe(true);
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
