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

  it('hands back the value it was given when an edit returns to it', async () => {
    const onValue = vi.fn();
    const { user } = render(
      <Field initial="@ada hi" resolvePlain={resolveAda} onValue={onValue} />,
    );
    const field = screen.getByRole('textbox', { name: 'Comment' });
    expect(field).toHaveValue('@Ada Lovelace hi');
    await user.click(field);
    await user.keyboard('{End}!');
    expect(onValue).toHaveBeenLastCalledWith(
      '[@Ada Lovelace](mention:user/u-ada) hi!',
    );
    await user.keyboard('{Backspace}');
    expect(onValue).toHaveBeenLastCalledWith('@ada hi');
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
});
