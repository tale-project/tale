// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { MentionTextarea } from './mention-textarea';

vi.mock('../lib/mention-actor-options', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/mention-actor-options')>()),
  useMentionActorOptions: () => [
    { type: 'agent', id: 'alice', name: 'Alice', handle: 'alice' },
    { type: 'agent', id: 'bob', name: 'Bob', handle: 'bob' },
  ],
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
