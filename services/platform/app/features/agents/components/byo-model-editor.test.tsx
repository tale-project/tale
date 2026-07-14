// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { ByoModelEditor } from './byo-model-editor';

// Regression coverage for #2679: a model id typed into "Provider model id"
// but never explicitly committed (Enter / + Add model) was silently thrown
// away — Save then persisted an empty model list. The pending draft now
// commits when focus leaves the field, so "type → Save" (whose click blurs
// the input first) keeps the model.

function draftInput() {
  // The add field is the only textbox; list rows render as <code>.
  return screen.getByRole<HTMLInputElement>('textbox');
}

afterEach(() => {
  cleanup();
});

describe('ByoModelEditor pending-draft commit (#2679)', () => {
  it('commits the typed model id on blur', () => {
    const onChange = vi.fn();
    render(<ByoModelEditor models={[]} onChange={onChange} />);

    fireEvent.change(draftInput(), {
      target: { value: 'claude-opus-4-20250514' },
    });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.blur(draftInput());
    expect(onChange).toHaveBeenCalledWith(['claude-opus-4-20250514']);
  });

  it('a duplicate or empty draft is not committed on blur', () => {
    const onChange = vi.fn();
    render(
      <ByoModelEditor
        models={['claude-opus-4-20250514']}
        onChange={onChange}
      />,
    );

    fireEvent.blur(draftInput());
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(draftInput(), {
      target: { value: 'claude-opus-4-20250514' },
    });
    fireEvent.blur(draftInput());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Enter still commits and clears the draft', () => {
    const onChange = vi.fn();
    render(<ByoModelEditor models={[]} onChange={onChange} />);

    fireEvent.change(draftInput(), { target: { value: 'gpt-4o' } });
    fireEvent.keyDown(draftInput(), { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['gpt-4o']);
    expect(draftInput().value).toBe('');
  });
});
