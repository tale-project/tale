import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Highlight } from './highlight';

describe('Highlight', () => {
  it('renders text unchanged when no terms are provided', () => {
    const { container } = render(<Highlight text="hello world" terms={[]} />);
    expect(container.textContent).toBe('hello world');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('wraps a single matched term in a <mark>', () => {
    render(<Highlight text="hello world" terms={['world']} />);
    const marks = screen.getAllByText('world');
    expect(marks[0]?.tagName).toBe('MARK');
  });

  it('is case-insensitive — keeps the original casing inside the mark', () => {
    render(<Highlight text="Hello World" terms={['world']} />);
    const mark = screen.getByText('World');
    expect(mark.tagName).toBe('MARK');
  });

  it('marks every occurrence of every term, in order', () => {
    const { container } = render(
      <Highlight text="config one config two" terms={['config']} />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(2);
    expect(marks[0]?.textContent).toBe('config');
    expect(marks[1]?.textContent).toBe('config');
  });

  it('supports multiple distinct terms', () => {
    const { container } = render(
      <Highlight
        text="configure the rag service"
        terms={['configure', 'rag']}
      />,
    );
    const marks = Array.from(container.querySelectorAll('mark')).map(
      (m) => m.textContent,
    );
    expect(marks).toContain('configure');
    expect(marks).toContain('rag');
  });

  it('escapes regex metacharacters in terms', () => {
    const { container } = render(
      <Highlight text="cost is $1.50 plus tax" terms={['$1.50']} />,
    );
    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('$1.50');
  });

  it('ignores empty/whitespace terms', () => {
    const { container } = render(
      <Highlight text="hello world" terms={['', ' ', 'world']} />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('world');
  });

  it('returns null for empty text', () => {
    const { container } = render(<Highlight text="" terms={['world']} />);
    expect(container.textContent).toBe('');
  });

  it('accepts a custom className applied to each mark', () => {
    const { container } = render(
      <Highlight
        text="hello world"
        terms={['world']}
        className="custom-mark"
      />,
    );
    expect(container.querySelector('mark')?.className).toContain('custom-mark');
  });

  it('preserves non-matching text outside of marks', () => {
    const { container } = render(
      <Highlight text="prefix world suffix" terms={['world']} />,
    );
    expect(container.textContent).toBe('prefix world suffix');
  });

  it('matches the longer term first when terms overlap as prefixes', () => {
    // Regression: MiniSearch can return both `config` and `configuration` for
    // a prefix search. Naively joining as `config|configuration` highlights
    // only "config" inside "configuration". The fix sorts by length DESC so
    // the longer alternative wins.
    const { container } = render(
      <Highlight
        text="The configuration is loaded from the config file."
        terms={['config', 'configuration']}
      />,
    );
    const marks = Array.from(container.querySelectorAll('mark')).map(
      (m) => m.textContent,
    );
    expect(marks).toEqual(['configuration', 'config']);
  });

  it('still marks the standalone shorter form when it is not part of a longer match', () => {
    const { container } = render(
      <Highlight text="config" terms={['config', 'configuration']} />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('config');
  });
});
