// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      const text = `${ns}.${key}`;
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          text,
        );
      }
      return text;
    },
  }),
}));

import { TagChipInput } from '../tag-chip-input';

afterEach(() => cleanup());

function setup(initial: string[] = []) {
  const onChange = vi.fn();
  const utils = render(
    <TagChipInput
      value={initial}
      onChange={onChange}
      maxTags={3}
      maxTagLength={10}
      label="Tags"
      placeholder="add tag"
    />,
  );
  const input = utils.getByLabelText('Tags') as HTMLInputElement;
  return { input, onChange, ...utils };
}

describe('TagChipInput', () => {
  it('passes axe audit', async () => {
    const { container } = render(
      <TagChipInput
        value={['alpha', 'beta']}
        onChange={vi.fn()}
        maxTags={3}
        maxTagLength={10}
        label="Tags"
      />,
    );
    await checkAccessibility(container);
  });

  it('adds a tag on Enter', () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['hello']);
  });

  it('adds a tag on comma', () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenCalledWith(['hi']);
  });

  it('removes last tag on Backspace when input is empty', () => {
    const { input, onChange } = setup(['a', 'b']);
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('rejects over-length tag with inline error', () => {
    const { input, onChange } = setup();
    fireEvent.change(input, { target: { value: 'a'.repeat(20) } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/prompts\.tagsInput\.tooLong/)).toBeInTheDocument();
  });

  it('does not commit duplicate tag (silent dedupe)', () => {
    const { input, onChange } = setup(['a']);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables input at the cap', () => {
    const { input } = setup(['a', 'b', 'c']);
    expect(input).toBeDisabled();
  });

  it('removes a tag via per-chip remove button', () => {
    const onChange = vi.fn();
    render(
      <TagChipInput
        value={['alpha', 'beta']}
        onChange={onChange}
        maxTags={3}
        maxTagLength={10}
        label="Tags"
      />,
    );
    // Two remove buttons share the same i18n key in the mock; pick the
    // first which corresponds to 'alpha'.
    const removeButtons = screen.getAllByLabelText(
      /prompts\.tagsInput\.removeAria/,
    );
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith(['beta']);
  });
});
