// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { MentionTextarea } from './mention-textarea';

// One array, as the real hook's memo hands out between changes.
const mentions = vi.hoisted(() => ({
  options: [
    { type: 'agent' as const, id: 'alice', name: 'Alice', handle: 'alice' },
    { type: 'agent' as const, id: 'bob', name: 'Bob', handle: 'bob' },
  ],
  reads: 0,
}));
vi.mock('../lib/mention-actor-options', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/mention-actor-options')>()),
  useMentionActorOptions: () => {
    mentions.reads += 1;
    return mentions.options;
  },
}));

function Composer() {
  const [value, setValue] = useState('');
  return (
    <MentionTextarea
      id="new-comment"
      label="Comment"
      organizationId="org"
      projectId="project"
      value={value}
      onValueChange={setValue}
    />
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  mentions.reads = 0;
});

// Every task opens with its comment composer on screen: the people, agents
// and automations it can mention are read once someone starts writing.
describe('mention textarea candidates', () => {
  it('reads nothing until the field is focused, then offers them', async () => {
    const { user } = render(<Composer />);
    expect(mentions.reads).toBe(0);

    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.click(field);
    expect(mentions.reads).toBeGreaterThan(0);
    await user.type(field, '@al');
    expect(screen.getByRole('option', { name: /Alice/ })).toBeInTheDocument();
  });
});

describe('mention textarea accessibility', () => {
  it('keeps multiline textbox semantics and keyboard mention selection', async () => {
    const { user } = render(<Composer />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).not.toHaveAttribute('aria-expanded');
    await user.type(field, '@');
    const list = screen.getByRole('listbox');
    expect(field).toHaveAttribute('aria-controls', list.id);
    await user.keyboard('{ArrowDown}');
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveTextContent('Bob');
    expect(field).toHaveAttribute('aria-activedescendant', selected.id);
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('@bob ');
    expect(field).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-controls');
    expect(field).not.toHaveAttribute('aria-activedescendant');
  });

  it('does not reference a missing listbox when no mention matches', async () => {
    const { user } = render(<Composer />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(field, '@nobody');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-controls');
    expect(field).not.toHaveAttribute('aria-activedescendant');
  });
});
