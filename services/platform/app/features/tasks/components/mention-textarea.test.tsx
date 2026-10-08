// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { MentionTextarea } from './mention-textarea';

const AGENT_ID = '3f2b8c1e-7d4a-4b6e-9a1c-2e5f8d7b6c40';

// One array, as the real hook's memo hands out between changes.
const mentions = vi.hoisted(() => ({
  options: [
    {
      type: 'agent' as const,
      id: '3f2b8c1e-7d4a-4b6e-9a1c-2e5f8d7b6c40',
      name: 'My Opus Agent #3',
      handle: 'my-opus-agent-3',
    },
    { type: 'agent' as const, id: 'bob', name: 'Bob', handle: 'bob' },
    {
      type: 'user' as const,
      id: 'u-ada',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      handle: 'ada',
    },
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

// The directory the field reads names from: the agent was renamed since a
// stored mention of it was written.
const directory = vi.hoisted(() => ({
  members: [{ id: 'u-ada', name: 'Ada Lovelace', email: 'ada@example.com' }],
  agents: [
    {
      id: '3f2b8c1e-7d4a-4b6e-9a1c-2e5f8d7b6c40',
      name: 'My Opus Agent #3',
      handle: 'my-opus-agent-3',
      legacyHandles: ['research.bot', 'researchbot'],
    },
    { id: 'bob', name: 'Bob', handle: 'bob', legacyHandles: [] },
  ],
  automations: [],
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => directory,
}));

function Composer({
  initial = '',
  onValue,
}: {
  initial?: string;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MentionTextarea
      id="new-comment"
      label="Comment"
      organizationId="org"
      projectId="project"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
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
    await user.type(field, '@bo');
    expect(screen.getByRole('option', { name: /Bob/ })).toBeInTheDocument();
  });

  it('finds an agent by its handle and its name, and shows the handle', async () => {
    const { user } = render(<Composer />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(field, '@my-opus');
    expect(
      screen.getByRole('option', { name: /My Opus Agent #3/ }),
    ).toHaveTextContent('@my-opus-agent-3 · Agents');
    await user.clear(field);
    await user.type(field, '@my opus');
    expect(
      screen.getByRole('option', { name: /My Opus Agent #3/ }),
    ).toBeInTheDocument();
  });
});

describe('mention textarea stored form', () => {
  it('shows the name of whom a picked mention names and stores the id', async () => {
    const onValue = vi.fn();
    const { user } = render(<Composer onValue={onValue} />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(field, 'Ask @my opus');
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('Ask @My Opus Agent #3 ');
    expect((field as HTMLTextAreaElement).value).not.toContain(AGENT_ID);
    expect(onValue).toHaveBeenLastCalledWith(
      `Ask [@My Opus Agent #3](mention:agent/${AGENT_ID}) `,
    );
  });

  it('shows stored and older mentions by today names, never an id', () => {
    render(
      <Composer
        initial={`[@Research Bot](mention:agent/${AGENT_ID}), @research.bot and @${AGENT_ID}`}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue(
      '@My Opus Agent #3, @My Opus Agent #3 and @My Opus Agent #3',
    );
  });
});

describe('mention textarea accessibility', () => {
  it('keeps multiline textbox semantics and keyboard mention selection', async () => {
    const { user } = render(<Composer />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field.tagName).toBe('TEXTAREA');
    expect(field).not.toHaveAttribute('aria-expanded');
    await user.type(field, '@');
    const list = screen.getByRole('listbox', {
      name: 'Mention a member, agent, or automation',
    });
    expect(field).toHaveAttribute('aria-controls', list.id);
    await user.keyboard('{ArrowDown}');
    const selected = screen.getByRole('option', { selected: true });
    expect(selected).toHaveTextContent('Bob');
    expect(field).toHaveAttribute('aria-activedescendant', selected.id);
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('@Bob ');
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
