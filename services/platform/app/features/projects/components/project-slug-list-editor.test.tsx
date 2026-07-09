import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import {
  ProjectSlugListEditor,
  type SlugOption,
} from './project-slug-list-editor';

const OPTIONS: SlugOption[] = [
  {
    value: 'assistant',
    label: 'Assistant',
    description: 'General-purpose AI assistant',
  },
  {
    value: 'coder',
    label: 'Coder',
    description: 'Writes, runs, and reviews code',
  },
];

describe('ProjectSlugListEditor', () => {
  it('keeps the ghost add button as the popover trigger when open', async () => {
    const { user } = render(
      <ProjectSlugListEditor
        value={[]}
        onChange={vi.fn()}
        options={OPTIONS}
        addLabel="Add agent"
        mode="recommended"
      />,
    );

    const addButton = screen.getByRole('button', { name: 'Add agent' });
    await user.click(addButton);

    expect(screen.getByRole('button', { name: 'Add agent' })).toBe(addButton);
    expect(screen.queryByRole('combobox')).toBeInTheDocument();
    expect(
      screen.getByText('General-purpose AI assistant'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('General-purpose AI assistant').className,
    ).toContain('line-clamp-2');
  });

  it('appends the selected slug and closes the picker', async () => {
    const onChange = vi.fn();
    const { user } = render(
      <ProjectSlugListEditor
        value={[]}
        onChange={onChange}
        options={OPTIONS}
        addLabel="Add agent"
        mode="recommended"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Add agent' }));
    const listbox = screen.getByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: /Coder/i }));

    expect(onChange).toHaveBeenCalledWith(['coder']);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('hides the add control when every option is already selected', () => {
    render(
      <ProjectSlugListEditor
        value={['assistant', 'coder']}
        onChange={vi.fn()}
        options={OPTIONS}
        addLabel="Add agent"
        mode="recommended"
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Add agent' }),
    ).not.toBeInTheDocument();
  });
});
