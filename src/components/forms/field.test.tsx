import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Field } from './field';
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
