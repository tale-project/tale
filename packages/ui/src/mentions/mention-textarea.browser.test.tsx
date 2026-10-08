import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { render, screen, waitFor } from '@/tests/utils/render';

import type { MentionOption } from './mention-options';
import { MentionTextarea } from './mention-textarea';

import '@tale/ui/globals.css';

afterEach(cleanup);

const KINDS = ['user', 'agent'] as const;
type Kind = (typeof KINDS)[number];

const OPTIONS: MentionOption<Kind>[] = [
  { kind: 'user', id: 'u-ada', name: 'Ada Lovelace', keywords: ['ada'] },
];
const nameOf = (ref: { kind: string; id: string }) =>
  ref.id === 'u-ada' ? 'Ada Lovelace' : undefined;

const ADA = '[@Ada Lovelace](mention:user/u-ada)';

function Field({
  initial,
  rows = 4,
  onValue,
}: {
  initial: string;
  rows?: number;
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div style={{ width: 360 }}>
      <MentionTextarea
        id="comment"
        label="Comment"
        rows={rows}
        kinds={KINDS}
        options={OPTIONS}
        nameOf={nameOf}
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
      />
    </div>
  );
}

function field(): HTMLTextAreaElement {
  return screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Comment' });
}

function layer(): HTMLElement {
  const found = document.querySelector<HTMLElement>(
    '[data-slot="mention-highlights"]',
  );
  if (found === null) throw new Error('no highlight layer');
  return found;
}

const UNDO = navigator.platform.toLowerCase().includes('mac')
  ? '{Meta>}z{/Meta}'
  : '{Control>}z{/Control}';

describe('MentionTextarea in a real engine', () => {
  // The tint is a second copy of the text under the textarea's own: it
  // only works if both lay the words out the same.
  it('lays the tint exactly over the name', () => {
    render(<Field initial={`First line\n${ADA} second`} />);
    const textarea = field();
    const mark = layer().querySelector('mark');
    if (mark === null) throw new Error('no mark');
    const box = textarea.getBoundingClientRect();
    const style = getComputedStyle(textarea);
    const left =
      box.left +
      Number.parseFloat(style.borderLeftWidth) +
      Number.parseFloat(style.paddingLeft);
    const top =
      box.top +
      Number.parseFloat(style.borderTopWidth) +
      Number.parseFloat(style.paddingTop);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const rect = mark.getBoundingClientRect();
    expect(rect.left).toBeCloseTo(left, 0);
    expect(rect.top).toBeGreaterThanOrEqual(top + lineHeight - 2);
    expect(rect.top).toBeLessThanOrEqual(top + lineHeight + 2);

    const canvas = document.createElement('canvas').getContext('2d');
    if (canvas === null) throw new Error('no canvas');
    canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const width = canvas.measureText('@Ada Lovelace').width;
    expect(Math.abs(rect.width - width)).toBeLessThan(2);
  });

  it('scrolls the tint with the text', async () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index}`);
    render(<Field rows={2} initial={`${lines.join('\n')}\n${ADA}`} />);
    const textarea = field();
    textarea.scrollTop = textarea.scrollHeight;
    textarea.dispatchEvent(new Event('scroll'));
    await waitFor(() => expect(layer().scrollTop).toBe(textarea.scrollTop));
    expect(textarea.scrollTop).toBeGreaterThan(0);
  });

  it('takes a whole name with one Backspace, and undo brings it back', async () => {
    const onValue = vi.fn();
    render(<Field initial={`Hi ${ADA}`} onValue={onValue} />);
    const textarea = field();
    await userEvent.click(textarea);
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await userEvent.keyboard('{Backspace}');
    expect(textarea).toHaveValue('Hi ');
    expect(onValue).toHaveBeenLastCalledWith('Hi ');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Removed the mention of Ada Lovelace',
    );

    await userEvent.keyboard(UNDO);
    expect(textarea).toHaveValue('Hi @Ada Lovelace');
    expect(onValue).toHaveBeenLastCalledWith(`Hi ${ADA}`);
  });

  it('picks a mention onto the undo stack', async () => {
    const onValue = vi.fn();
    render(<Field initial="" onValue={onValue} />);
    const textarea = field();
    await userEvent.click(textarea);
    await userEvent.keyboard('@ada');
    await userEvent.keyboard('{Enter}');
    expect(textarea).toHaveValue('@Ada Lovelace ');
    expect(onValue).toHaveBeenLastCalledWith(`${ADA} `);
    await userEvent.keyboard(UNDO);
    expect(textarea).toHaveValue('@ada');
  });

  // A phone keyboard deletes inside the word it is composing without a
  // cancelable `beforeinput`; the rest of the name goes after the fact.
  it('takes the rest of a name a deletion bit into', async () => {
    const onValue = vi.fn();
    render(<Field initial={`Hi ${ADA}`} onValue={onValue} />);
    const textarea = field();
    textarea.focus();
    const end = textarea.value.length;
    textarea.setRangeText('', end - 1, end, 'end');
    textarea.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'deleteContentBackward',
      }),
    );
    await waitFor(() => expect(textarea).toHaveValue('Hi '));
    expect(onValue).toHaveBeenLastCalledWith('Hi ');
  });

  it('copies and pastes a mention as a mention', async () => {
    const onValue = vi.fn();
    render(<Field initial={`Hi ${ADA}`} onValue={onValue} />);
    const textarea = field();
    await userEvent.click(textarea);
    textarea.setSelectionRange(0, textarea.value.length);
    const data = new DataTransfer();
    textarea.dispatchEvent(
      new ClipboardEvent('copy', { bubbles: true, clipboardData: data }),
    );
    expect(data.getData('text/plain')).toBe('Hi @Ada Lovelace');
    expect(data.getData('text/x-tale-mentions')).toBe(`Hi ${ADA}`);

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    textarea.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, clipboardData: data }),
    );
    await waitFor(() =>
      expect(textarea).toHaveValue('Hi @Ada LovelaceHi @Ada Lovelace'),
    );
    expect(onValue).toHaveBeenLastCalledWith(`Hi ${ADA}Hi ${ADA}`);
  });
});
