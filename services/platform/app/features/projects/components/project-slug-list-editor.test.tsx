import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import {
  ProjectSlugListAdd,
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

describe('ProjectSlugListAdd', () => {
  it('keeps the add button as the popover trigger when open', async () => {
    const { user } = render(
      <ProjectSlugListAdd
        value={[]}
        onChange={vi.fn()}
        options={OPTIONS}
        addLabel="Add agent"
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
      <ProjectSlugListAdd
        value={[]}
        onChange={onChange}
        options={OPTIONS}
        addLabel="Add agent"
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
      <ProjectSlugListAdd
        value={['assistant', 'coder']}
        onChange={vi.fn()}
        options={OPTIONS}
        addLabel="Add agent"
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Add agent' }),
    ).not.toBeInTheDocument();
  });
});

describe('ProjectSlugListEditor', () => {
  it('renders ordered rows for the current value', () => {
    render(
      <ProjectSlugListEditor
        value={['coder', 'assistant']}
        onChange={vi.fn()}
        options={OPTIONS}
        mode="recommended"
      />,
    );

    expect(screen.getByText('Coder')).toBeInTheDocument();
    expect(screen.getByText('Assistant')).toBeInTheDocument();
  });

  it('shows the lockout banner when restricted and empty', () => {
    render(
      <ProjectSlugListEditor
        value={[]}
        onChange={vi.fn()}
        options={OPTIONS}
        mode="restricted"
      />,
    );

    expect(screen.getByText(/lockout|empty|restricted/i)).toBeInTheDocument();
  });
});
