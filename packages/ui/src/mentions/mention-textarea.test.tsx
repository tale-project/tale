import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { MentionOption } from './mention-options';
import { MentionTextarea } from './mention-textarea';

const KINDS = ['user', 'agent'] as const;
type Kind = (typeof KINDS)[number];

const OPTIONS: MentionOption<Kind>[] = [
  { kind: 'user', id: 'u-ada', name: 'Ada Lovelace', keywords: ['ada'] },
  {
    kind: 'agent',
    id: 'a-opus',
    name: 'My Opus Agent #3',
    caption: '@my-opus-agent-3 · Agents',
    keywords: ['my-opus-agent-3'],
  },
];

const NAMES: Record<string, string> = {
  'user:u-ada': 'Ada Lovelace',
  'agent:a-opus': 'My Opus Agent #3',
};
const nameOf = (ref: { kind: string; id: string }) =>
  NAMES[`${ref.kind}:${ref.id}`];

const resolveAda = (handle: string) =>
  handle === 'ada'
    ? { kind: 'user' as const, id: 'u-ada', name: 'Ada Lovelace' }
    : null;

function Field({
  initial = '',
  onValue,
  resolvePlain,
}: {
  initial?: string;
  onValue?: (value: string) => void;
  resolvePlain?: typeof resolveAda;
}) {
  const [value, setValue] = useState(initial);
  return (
    <MentionTextarea
      id="comment"
      label="Comment"
      kinds={KINDS}
      options={OPTIONS}
      nameOf={nameOf}
      resolvePlain={resolvePlain}
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
});

describe('MentionTextarea', () => {
  it('shows a stored mention by its current name', () => {
    render(
      <Field initial="Hi [@Old Name](mention:agent/a-opus), [@Gone](mention:user/u-x)" />,
    );
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue(
      'Hi @My Opus Agent #3, @Gone',
    );
  });

  it('picks a mention by name and stores whom it names', async () => {
    const onValue = vi.fn();
    const { user } = render(<Field onValue={onValue} />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(field, 'Ask @my opus');
    const option = screen.getByRole('option', { name: /My Opus Agent #3/ });
    expect(option).toHaveTextContent('@my-opus-agent-3 · Agents');
    await user.keyboard('{Enter}');
    expect(field).toHaveValue('Ask @My Opus Agent #3 ');
    expect(onValue).toHaveBeenLastCalledWith(
      'Ask [@My Opus Agent #3](mention:agent/a-opus) ',
    );
    expect(field).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Mentioned My Opus Agent #3',
    );
  });

  it('keeps combobox semantics and closes when a spaced query finds nobody', async () => {
    const { user } = render(<Field />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field.tagName).toBe('TEXTAREA');
    await user.type(field, '@');
    const list = screen.getByRole('listbox', { name: 'Mention someone' });
    expect(field).toHaveAttribute('aria-controls', list.id);
    await user.keyboard('{ArrowDown}');
    const selected = screen.getByRole('option', { selected: true });
    expect(field).toHaveAttribute('aria-activedescendant', selected.id);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.type(field, ' @ada please');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByText('No matches')).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-activedescendant');
  });

  it('removes a whole mention with one Backspace and announces it', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Field
        initial="Hi [@Ada Lovelace](mention:user/u-ada)"
        onValue={onValue}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.click(field);
    await user.keyboard('{End}{Backspace}');
    expect(field).toHaveValue('Hi ');
    expect(onValue).toHaveBeenLastCalledWith('Hi ');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Removed the mention of Ada Lovelace',
    );
  });

  it('turns a name into text when someone types inside it', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Field
        initial="[@Ada Lovelace](mention:user/u-ada) hi"
        onValue={onValue}
      />,
    );
    const field = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Comment',
    });
    await user.click(field);
    field.setSelectionRange(4, 4);
    await user.keyboard('X');
    expect(field).toHaveValue('@AdaX Lovelace hi');
    expect(onValue).toHaveBeenLastCalledWith('@AdaX Lovelace hi');
  });

  it('keeps a mention whole when typing right after it', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Field initial="[@Ada Lovelace](mention:user/u-ada)" onValue={onValue} />,
    );
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.click(field);
    await user.keyboard('{End}!');
    expect(onValue).toHaveBeenLastCalledWith(
      '[@Ada Lovelace](mention:user/u-ada)!',
    );
  });

  it('shows a typed handle by name and writes it back as typed', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Field initial="@Ada hi" resolvePlain={resolveAda} onValue={onValue} />,
    );
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field).toHaveValue('@Ada Lovelace hi');
    await user.click(field);
    await user.keyboard('{End}!');
    // Whom the handle names stays the saving server's call.
    expect(onValue).toHaveBeenLastCalledWith('@Ada hi!');
  });

  it('hands back the value it was given when an edit returns to it', async () => {
    const onValue = vi.fn();
    const initial = 'Hi [@Old Name](mention:user/u-ada)';
    const { user } = render(<Field initial={initial} onValue={onValue} />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field).toHaveValue('Hi @Ada Lovelace');
    await user.click(field);
    await user.keyboard('{End}!');
    expect(onValue).toHaveBeenLastCalledWith(
      'Hi [@Ada Lovelace](mention:user/u-ada)!',
    );
    await user.keyboard('{Backspace}');
    expect(onValue).toHaveBeenLastCalledWith(initial);
  });

  it('follows names that arrive late until someone types, then keeps the words', async () => {
    function Late({ names }: { names: Record<string, string> }) {
      const [value, setValue] = useState('Hi [@Old Name](mention:user/u-ada)');
      return (
        <MentionTextarea
          label="Comment"
          kinds={KINDS}
          options={OPTIONS}
          nameOf={(ref) => names[`${ref.kind}:${ref.id}`]}
          value={value}
          onValueChange={setValue}
        />
      );
    }
    const { user, rerender } = render(<Late names={{}} />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field).toHaveValue('Hi @Old Name');
    rerender(<Late names={{ 'user:u-ada': 'Ada Lovelace' }} />);
    expect(field).toHaveValue('Hi @Ada Lovelace');
    await user.click(field);
    await user.keyboard('{End}!');
    rerender(<Late names={{ 'user:u-ada': 'Ada King' }} />);
    expect(field).toHaveValue('Hi @Ada Lovelace!');
  });

  it('never opens the picker inside code', async () => {
    const { user } = render(<Field />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(field, '`code @ad');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '`x` and `code @ad');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, '```\n@ad');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('asks for its options once, when first focused', async () => {
    const onOptionsWanted = vi.fn();
    const { user } = render(
      <MentionTextarea
        label="Comment"
        kinds={KINDS}
        options={[]}
        value=""
        onValueChange={() => undefined}
        onOptionsWanted={onOptionsWanted}
      />,
    );
    expect(onOptionsWanted).not.toHaveBeenCalled();
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.click(field);
    await user.tab();
    await user.click(field);
    expect(onOptionsWanted).toHaveBeenCalledTimes(1);
  });

  it('says what is typed after @, for options searched on a server', async () => {
    const onQueryChange = vi.fn();
    function Searched() {
      const [value, setValue] = useState('');
      return (
        <MentionTextarea
          label="Comment"
          kinds={KINDS}
          options={OPTIONS}
          value={value}
          onValueChange={setValue}
          onQueryChange={onQueryChange}
        />
      );
    }
    const { user } = render(<Searched />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    await user.type(field, 'Hi @ad');
    expect(onQueryChange.mock.calls.map(([query]) => query)).toEqual([
      null,
      '',
      'a',
      'ad',
    ]);

    await user.keyboard('{Escape}');
    expect(onQueryChange).toHaveBeenLastCalledWith(null);
  });

  it('shows its note under the options and reads it out once while open', async () => {
    function Noted({ note }: { note?: string }) {
      const [value, setValue] = useState('');
      return (
        <MentionTextarea
          label="Comment"
          kinds={KINDS}
          options={OPTIONS}
          value={value}
          onValueChange={setValue}
          note={note}
        />
      );
    }
    // What the picker shows, not what the field read out.
    const shown = (text: string) =>
      screen.queryByText(text, { ignore: '[role="status"]' });
    const { user, rerender } = render(<Noted note="Not everyone is listed" />);
    const field = screen.getByRole('textbox', { name: 'Comment' });
    const status = screen.getByRole('status');
    expect(shown('Not everyone is listed')).not.toBeInTheDocument();

    await user.type(field, '@');
    const note = shown('Not everyone is listed');
    expect(note).toBeInTheDocument();
    expect(screen.getByRole('listbox')).not.toContainElement(note);
    expect(status.textContent).toBe('Not everyone is listed');
    // The same words again, as the search answers what is typed, are not
    // read out again; new words are.
    rerender(<Noted />);
    expect(shown('Not everyone is listed')).not.toBeInTheDocument();
    rerender(<Noted note="Not everyone is listed" />);
    await user.type(field, 'zz');
    expect(status.textContent).toBe('Not everyone is listed');
    // Under the empty label too.
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(shown('Not everyone is listed')).toBeInTheDocument();
    rerender(<Noted note="People could not be searched" />);
    expect(status).toHaveTextContent('People could not be searched');
  });
});
