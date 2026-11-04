import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Field } from './field';
import { FIELD_INVALID } from './field-focus';
import { Input } from './input';

describe('Field', () => {
  it('wires the description to the control via aria-describedby', () => {
    const { getByRole } = render(
      <Field label="Email" htmlFor="email" description="No spam.">
        <Input id="email" />
      </Field>,
    );
    const input = getByRole('textbox');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
  });

  it('sets aria-invalid and role=alert when an error is present', () => {
    const { getByRole } = render(
      <Field label="Email" htmlFor="email" error="Required">
        <Input id="email" />
      </Field>,
    );
    expect(getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
    expect(getByRole('alert')).toHaveTextContent('Required');
  });

  it("draws the design's Error state on the control: the destructive border", () => {
    const { getByRole, rerender } = render(
      <Field label="Email" htmlFor="email" error="Required">
        <Input id="email" className="font-mono" />
      </Field>,
    );
    // The control's own classes stay; the invalid border joins them.
    expect(getByRole('textbox')).toHaveClass(
      'font-mono',
      ...FIELD_INVALID.split(' '),
    );
    rerender(
      <Field label="Email" htmlFor="email">
        <Input id="email" className="font-mono" />
      </Field>,
    );
    expect(getByRole('textbox')).toHaveClass('font-mono');
    expect(getByRole('textbox')).not.toHaveClass('border-destructive');
  });

  describe('issues', () => {
    const ISSUES = [
      {
        id: 'unknown-node',
        severity: 'error' as const,
        message: 'There is no node called "nope".',
      },
      {
        id: 'maybe-empty',
        severity: 'warning' as const,
        message: 'This can be empty when the triage is skipped.',
      },
    ];

    it('describes the control with every line, and leaves the description in place', () => {
      const { getByRole } = render(
        <Field
          label="Prompt"
          htmlFor="prompt"
          description="What the agent is asked."
          issues={ISSUES}
        >
          <Input id="prompt" />
        </Field>,
      );
      const input = getByRole('textbox');
      expect(input).toHaveAccessibleDescription(
        'Error: There is no node called "nope". Warning: This can be empty when the triage is skipped. What the agent is asked.',
      );
      expect(getByRole('list')).toHaveTextContent(
        'There is no node called "nope".',
      );
    });

    it('marks the control invalid only when an error is among them', () => {
      const { getByRole, rerender } = render(
        <Field label="Prompt" htmlFor="prompt" issues={ISSUES}>
          <Input id="prompt" />
        </Field>,
      );
      expect(getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
      expect(getByRole('textbox')).toHaveClass('border-destructive');
      rerender(
        <Field label="Prompt" htmlFor="prompt" issues={ISSUES.slice(1)}>
          <Input id="prompt" />
        </Field>,
      );
      expect(getByRole('textbox')).not.toHaveAttribute('aria-invalid');
      expect(getByRole('textbox')).not.toHaveClass('border-destructive');
    });

    it('never raises an alert for them', () => {
      const { queryByRole } = render(
        <Field label="Prompt" htmlFor="prompt" issues={ISSUES}>
          <Input id="prompt" />
        </Field>,
      );
      expect(queryByRole('alert')).toBeNull();
    });

    it('keeps the error and the issues apart, the error first', () => {
      const { getByRole } = render(
        <Field
          label="Prompt"
          htmlFor="prompt"
          error="Required"
          issues={ISSUES.slice(1)}
        >
          <Input id="prompt" />
        </Field>,
      );
      expect(getByRole('textbox')).toHaveAccessibleDescription(
        'Required Warning: This can be empty when the triage is skipped.',
      );
      expect(getByRole('alert')).toHaveTextContent('Required');
    });

    it('passes axe audit with issues', async () => {
      const { container } = render(
        <Field label="Prompt" htmlFor="prompt" issues={ISSUES}>
          <Input id="prompt" />
        </Field>,
      );
      await checkAccessibility(container);
    });
  });

  // A contenteditable control (a code editor) is not labelable: `<label
  // for>` names nothing, so Field points `aria-labelledby` at its label.
  describe('controls named by aria-labelledby', () => {
    function Editable(props: Record<string, unknown>) {
      return <div role="textbox" tabIndex={0} {...props} />;
    }
    const Named = Object.assign(Editable, {
      fieldLabelling: 'labelledby' as const,
    });

    it('names the control by its label', () => {
      const { getByRole } = render(
        <Field label="Code" htmlFor="code">
          <Named id="code" aria-labelledby="extra" />
        </Field>,
      );
      expect(getByRole('textbox', { name: 'Code' })).toBeInTheDocument();
      const labelledBy =
        getByRole('textbox').getAttribute('aria-labelledby') ?? '';
      expect(labelledBy.split(' ')[0]).toBe('extra');
    });

    it('leaves an ordinary control to <label for>', () => {
      const { getByRole } = render(
        <Field label="Email" htmlFor="email">
          <Input id="email" />
        </Field>,
      );
      expect(getByRole('textbox')).not.toHaveAttribute('aria-labelledby');
      expect(getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('passes axe audit with label + description', async () => {
      const { container } = render(
        <Field label="Email" htmlFor="email" description="No spam.">
          <Input id="email" />
        </Field>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit in the error state', async () => {
      const { container } = render(
        <Field label="Email" htmlFor="email" error="Enter a valid email.">
          <Input id="email" defaultValue="x" />
        </Field>,
      );
      await checkAccessibility(container);
    });
  });
});
