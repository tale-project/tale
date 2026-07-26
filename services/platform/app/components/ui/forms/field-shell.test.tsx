// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { FIELD_LAYOUT_ROW, FieldShell } from './field-shell';
import { Input } from './input';

/**
 * The shell decides orientation from the SURFACE, via a `data-` attribute on an
 * ancestor, so these tests assert the contract a container relies on: the
 * attribute is what a settings page spreads, and the field's own markup is the
 * same either way (only classes differ). What the classes then do is Tailwind's
 * job, not this suite's.
 */
describe('FieldShell', () => {
  it('keeps label, description, control and error in reading order', () => {
    render(
      <FieldShell
        label={<span>Display name</span>}
        description={<span>Shown to teammates</span>}
        error={<span role="alert">Too short</span>}
      >
        <input aria-label="Display name field" />
      </FieldShell>,
    );

    const rendered = screen.getByLabelText('Display name field');
    expect(rendered).toBeInTheDocument();
    expect(screen.getByText('Display name')).toBeInTheDocument();
    expect(screen.getByText('Shown to teammates')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Too short');

    // The description precedes the control in the DOM, which is the order
    // design/docs/app.md mandates and what a screen reader announces.
    const description = screen.getByText('Shown to teammates');
    expect(
      description.compareDocumentPosition(rendered) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders no label column when the field has neither label nor description', () => {
    const { container } = render(
      <FieldShell>
        <input aria-label="Bare" />
      </FieldShell>,
    );

    // Frame + control column only.
    expect(container.querySelectorAll('div')).toHaveLength(2);
  });

  it('marks a row-layout container so the fields beneath it lay out sideways', () => {
    const { container } = render(
      <div {...FIELD_LAYOUT_ROW}>
        <Input label="Workspace name" />
      </div>,
    );

    expect(container.firstElementChild).toHaveAttribute(
      'data-field-layout',
      'row',
    );
    // Same markup as a stacked field — the switch is CSS, so nothing about the
    // control or its label changes.
    expect(
      screen.getByRole('textbox', { name: 'Workspace name' }),
    ).toBeInTheDocument();
  });
  it('threads height through the frame and control column for fillHeight', () => {
    const { container } = render(
      <FieldShell fillHeight>
        <textarea aria-label="Body" />
      </FieldShell>,
    );

    const frame = container.firstElementChild;
    expect(frame).toHaveClass('min-h-0', 'flex-1');
    // The control column (the frame's only div child here) stretches too —
    // without it the frame's height would never reach the control.
    expect(frame?.querySelector('div')).toHaveClass('min-h-0', 'flex-1');
  });
});
