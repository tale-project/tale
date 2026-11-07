import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Label } from './label';

describe('Label', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<Label>Email</Label>);
      await checkAccessibility(container);
    });

    it('passes axe audit when required', async () => {
      const { container } = render(<Label required>Email</Label>);
      await checkAccessibility(container);
    });

    it('renders optional indicator for required={false}', () => {
      render(<Label required={false}>Email</Label>);
      expect(screen.getByText(/optional/i)).toBeInTheDocument();
    });

    // The suffix at 70 % opacity read 2.8:1 on a card (2026-09-26
    // evaluation, B-08); the full muted token clears AA at 5:1.
    it('renders the optional suffix at full muted contrast', () => {
      render(<Label required={false}>Email</Label>);
      const suffix = screen.getByText(/optional/i);
      expect(suffix).toHaveClass('text-muted-foreground');
      expect(suffix.className).not.toMatch(/muted-foreground\//);
    });

    it('passes axe audit with error styling', async () => {
      const { container } = render(<Label error>Email</Label>);
      await checkAccessibility(container);
    });

    it('passes axe audit with an info tooltip', async () => {
      const { container } = render(
        <Label info="Use a public domain.">Domain</Label>,
      );
      await checkAccessibility(container);
    });
  });

  // A click on a label whose target is not labelable (a code editor's
  // contenteditable text) still moves focus there.
  describe('a target that is not labelable', () => {
    it('takes focus when the label is clicked', async () => {
      const { user } = render(
        <>
          <Label htmlFor="editable">Code</Label>
          <div id="editable" role="textbox" tabIndex={0} contentEditable />
        </>,
      );
      await user.click(screen.getByText('Code'));
      expect(screen.getByRole('textbox')).toHaveFocus();
    });

    it('leaves a labelable target to the browser', async () => {
      const { user } = render(
        <>
          <Label htmlFor="plain">Name</Label>
          <input id="plain" />
        </>,
      );
      await user.click(screen.getByText('Name'));
      expect(screen.getByRole('textbox')).toHaveFocus();
    });
  });

  describe('info tooltip', () => {
    it('renders a keyboard-focusable info button with an aria-label', () => {
      render(<Label info="Use a public domain.">Domain</Label>);
      const button = screen.getByRole('button', { name: /more information/i });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('type', 'button');
    });

    it('renders no info button when info is omitted', () => {
      render(<Label>Domain</Label>);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
