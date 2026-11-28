import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState, type CSSProperties } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useAutoGrow } from './use-auto-grow';

const LINE = 20;

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `Line ${index + 1}`).join(
    '\n',
  );
}

/** A transcript above a message field, laid out as a conversation lays them
 * out: a column of fixed height whose scroller takes what the field leaves. */
function Conversation({
  initial = '',
  maxLines,
  border = 0,
}: {
  initial?: string;
  maxLines?: number;
  border?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  useAutoGrow(ref, value);
  const field: CSSProperties = {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    font: `16px/${LINE}px sans-serif`,
    padding: 0,
    margin: 0,
    border: `${border}px solid`,
    minHeight: LINE + 2 * border,
    resize: 'none',
    ...(maxLines === undefined ? {} : { maxHeight: maxLines * LINE }),
  };
  return (
    <div
      data-testid="column"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 400,
        width: 320,
      }}
    >
      <div
        data-testid="transcript"
        style={{ flex: '1 1 0', minHeight: 0, overflowY: 'auto' }}
      >
        <div style={{ height: 2000 }} />
      </div>
      <div>
        <textarea
          ref={ref}
          aria-label="Message"
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          style={field}
        />
      </div>
    </div>
  );
}

function height(element: Element): number {
  return element.getBoundingClientRect().height;
}

afterEach(cleanup);

describe('useAutoGrow (Chromium)', () => {
  it('grows a line with each line typed and gives it back when it goes', () => {
    render(<Conversation />);
    const field = screen.getByRole('textbox');
    expect(height(field)).toBe(LINE);

    fireEvent.change(field, { target: { value: lines(3) } });
    expect(height(field)).toBe(3 * LINE);

    fireEvent.change(field, { target: { value: lines(1) } });
    expect(height(field)).toBe(LINE);

    fireEvent.change(field, { target: { value: '' } });
    expect(height(field)).toBe(LINE);
  });

  it('stops at its max-height and scrolls inside, keeping the reader’s place', () => {
    render(<Conversation maxLines={5} />);
    const field = screen.getByRole<HTMLTextAreaElement>('textbox');

    fireEvent.change(field, { target: { value: lines(12) } });
    expect(height(field)).toBe(5 * LINE);
    expect(field.scrollHeight).toBeGreaterThan(field.clientHeight);

    field.scrollTop = 2 * LINE;
    fireEvent.change(field, { target: { value: `${lines(12)}!` } });
    expect(height(field)).toBe(5 * LINE);
    expect(field.scrollTop).toBe(2 * LINE);
  });

  // Measuring collapses the field for a moment. Had the column seen it, the
  // transcript would have grown and read a scroll position clamped to its
  // new end; it must still sit at its end once the field is measured, and
  // the parent's hold must be released.
  it('keeps the transcript above the field at its end while it measures', () => {
    render(<Conversation initial={lines(5)} />);
    const field = screen.getByRole('textbox');
    const transcript = screen.getByTestId('transcript');
    expect(height(field)).toBe(5 * LINE);
    transcript.scrollTop = transcript.scrollHeight;
    const end = transcript.scrollHeight - transcript.clientHeight;
    expect(transcript.scrollTop).toBe(end);

    fireEvent.change(field, { target: { value: `${lines(5)}!` } });
    expect(height(field)).toBe(5 * LINE);
    expect(transcript.scrollTop).toBe(end);
    expect(field.parentElement?.style.minHeight).toBe('');
  });

  it('fits again when its width changes', async () => {
    render(<Conversation initial={'word '.repeat(60).trim()} />);
    const field = screen.getByRole('textbox');
    const wide = height(field);
    expect(wide).toBeGreaterThan(LINE);

    screen.getByTestId('column').style.width = '160px';
    await expect.poll(() => height(field)).toBeGreaterThan(wide);
    expect(field.scrollHeight).toBe(field.clientHeight);
  });

  it('counts its own border into the height it fits', () => {
    render(<Conversation border={1} />);
    const field = screen.getByRole('textbox');

    fireEvent.change(field, { target: { value: lines(3) } });
    expect(height(field)).toBe(3 * LINE + 2);
    expect(field.scrollHeight).toBe(field.clientHeight);
  });
});
