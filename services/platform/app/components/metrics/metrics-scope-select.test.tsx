import { describe, expect, it, vi } from 'vitest';

import type { MetricsScopeOption } from '@/app/components/metrics/metrics-scope';
import { MetricsScopeSelect } from '@/app/components/metrics/metrics-scope-select';
import { render, screen, within } from '@/tests/utils/render';

const PROJECTS: MetricsScopeOption[] = [
  { value: 'p1', label: 'Getting started' },
  { value: 'p2', label: 'Website migration' },
];

function renderScope(
  overrides: Partial<React.ComponentProps<typeof MetricsScopeSelect>> = {},
) {
  const onValueChange = vi.fn();
  return {
    onValueChange,
    ...render(
      <MetricsScopeSelect
        label="Project"
        options={PROJECTS}
        value={undefined}
        onValueChange={onValueChange}
        placeholder="Select a project"
        searchPlaceholder="Search projects"
        emptyText="No projects found"
        {...overrides}
      />,
    ),
  };
}

// The scope select exists because the project picker used to be a section of
// the "Filter" popover: a required subject hidden behind an optional-sounding
// control, invisible once chosen. These tests pin both halves of the fix —
// the picker is reachable without opening anything, and the live scope is
// readable straight off the toolbar.
describe('MetricsScopeSelect', () => {
  it('offers the picker without opening a filter popover', () => {
    renderScope();
    expect(
      screen.getByRole('button', { name: 'Select a project' }),
    ).toBeInTheDocument();
  });

  it('names the scoped subject and its dimension on the trigger', () => {
    renderScope({ value: 'p1' });
    const trigger = screen.getByRole('button', {
      name: 'Project: Getting started',
    });
    // Separated, not jammed: the trigger's `[&>span]:line-clamp-1` overrides a
    // nested flex row's display, so a gap utility would render
    // "ProjectGetting started" — the separator has to survive the cascade.
    expect(trigger).toHaveTextContent('Project: Getting started');
    expect(within(trigger).getByText('Project')).toBeInTheDocument();
  });

  it('lists the subjects and reports the pick', async () => {
    const { user, onValueChange } = renderScope({ value: 'p1' });

    await user.click(screen.getByRole('button', { name: /^Project:/ }));
    const listbox = screen.getByRole('listbox', { name: 'Project' });
    expect(
      within(listbox).getByRole('option', { name: /Getting started/ }),
    ).toHaveAttribute('aria-selected', 'true');

    await user.click(
      within(listbox).getByRole('option', { name: /Website migration/ }),
    );
    expect(onValueChange).toHaveBeenCalledWith('p2');
  });

  it('says so when there is nothing to scope to', async () => {
    const { user } = renderScope({ options: [] });

    await user.click(screen.getByRole('button', { name: 'Select a project' }));
    expect(screen.getByText('No projects found')).toBeInTheDocument();
  });
});
