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
  // What the field searched the people for, read by read.
  queries: [] as string[],
  searching: false,
  unavailable: false,
  more: false,
}));
vi.mock('../lib/mention-actor-options', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/mention-actor-options')>()),
  useMentionActorOptions: (
    _organizationId: string,
    _projectId: string,
    query: string,
  ) => {
    mentions.reads += 1;
    mentions.queries.push(query);
    return {
      options: mentions.options,
      searching: mentions.searching,
      unavailable: mentions.unavailable,
      more: mentions.more,
    };
  },
}));

// The directory the field reads names from: the agent was renamed since a
// stored mention of it was written.
const directory = vi.hoisted(() => ({
  // Bobby's email name is `bob`, which the agent Bob answers to as well.
  members: [
    { id: 'u-ada', name: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 'u-bob', name: 'Bobby Tables', email: 'bob@example.com' },
  ],
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
  // Everyone has arrived.
  memberPending: () => false,
  mentionPending: () => false,
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => directory,
}));

function Composer({
  initial = '',
  onValue,
  saved,
  plainMentions,
}: {
  initial?: string;
  onValue?: (value: string) => void;
  saved?: { type: 'user' | 'agent' | 'automation'; id: string }[];
  plainMentions?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MentionTextarea
      id="new-comment"
      label="Comment"
      organizationId="org"
      projectId="project"
      {...(saved === undefined ? {} : { mentions: saved })}
      {...(plainMentions === undefined ? {} : { plainMentions })}
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
  mentions.queries = [];
  mentions.searching = false;
  mentions.unavailable = false;
  mentions.more = false;
});

// What the picker shows, not what the field read out.
const shown = (text: string | RegExp) =>
  screen.queryByText(text, { ignore: '[role="status"]' });

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

  it('searches the people for what is typed after the @', async () => {
    const { user } = render(<Composer />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(field, 'Ask @ad');
    expect(mentions.queries.at(-1)).toBe('ad');
    expect(
      screen.getByRole('option', { name: /Ada Lovelace/ }),
    ).toBeInTheDocument();
    // With no mention typed, nobody is searched for.
    await user.clear(field);
    expect(mentions.queries.at(-1)).toBe('');
  });

  it('says the people are still searched rather than no matches', async () => {
    mentions.searching = true;
    const { user } = render(<Composer />);
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), '@zed');
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();
    // Searching is no news: nothing is read out for it.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('says the people could not be searched, whatever else it offers', async () => {
    mentions.unavailable = true;
    const { user } = render(<Composer />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(field, '@bo');
    // The agent Bob is offered: only the people could not be searched.
    expect(screen.getByRole('option', { name: /Bob/ })).toBeInTheDocument();
    expect(shown(/People couldn't be searched/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      /People couldn't be searched/,
    );

    await user.type(field, 'zz');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(shown(/People couldn't be searched/)).toBeInTheDocument();
  });

  it('says more people match than it offers', async () => {
    mentions.more = true;
    const { user } = render(<Composer />);
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), '@ad');
    expect(
      screen.getByRole('option', { name: /Ada Lovelace/ }),
    ).toBeInTheDocument();
    expect(
      shown('More people match — keep typing to narrow the list.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'More people match — keep typing to narrow the list.',
    );
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

// Whom a typed handle names is the saving server's call: it knows who can be
// mentioned on the task, whom a comment was saved naming, and which texts
// keep another system's `@names`. The field shows the name and writes the
// handle back as typed.
describe('mention textarea older handles', () => {
  it('writes a typed handle back as typed after an edit', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Composer initial="cc @research.bot on the crash" onValue={onValue} />,
    );
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field).toHaveValue('cc @My Opus Agent #3 on the crash');
    await user.click(field);
    await user.keyboard('{End}!');
    expect(onValue).toHaveBeenLastCalledWith('cc @research.bot on the crash!');
  });

  it('keeps a mirrored description’s @names as written', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Composer
        initial="Reported by @ada and @bob"
        plainMentions={false}
        onValue={onValue}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field).toHaveValue('Reported by @ada and @bob');
    await user.click(field);
    await user.keyboard('{End}.');
    expect(onValue).toHaveBeenLastCalledWith('Reported by @ada and @bob.');
  });

  it('shows the one a comment named for a handle two answer to', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Composer
        initial="@bob please check"
        saved={[{ type: 'user', id: 'u-bob' }]}
        onValue={onValue}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Comment' });
    // The person the comment named, not the agent the handle names today.
    expect(field).toHaveValue('@Bobby Tables please check');
    await user.click(field);
    await user.keyboard('{End}!');
    expect(onValue).toHaveBeenLastCalledWith('@bob please check!');
  });

  it('shows a handle a comment named nobody by as written', () => {
    render(<Composer initial="@bob please check" saved={[]} />);
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue(
      '@bob please check',
    );
  });

  it('reads a deleted agent’s id as a deleted agent and keeps the id', async () => {
    const gone = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
    const onValue = vi.fn();
    const { user } = render(
      <Composer initial={`ask @${gone} again`} onValue={onValue} />,
    );
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field).toHaveValue('ask @Deleted agent again');
    await user.click(field);
    await user.keyboard('{End}?');
    expect(onValue).toHaveBeenLastCalledWith(`ask @${gone} again?`);
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
