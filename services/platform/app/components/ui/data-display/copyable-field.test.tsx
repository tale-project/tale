import { describe, it, expect } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, screen } from '@/test/utils/render';

import { CopyableField, CopyableText } from './copyable-field';

describe('CopyableField', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CopyableField value="abc-123" label="API Key" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit without label using aria-label', async () => {
      const { container } = render(
        <CopyableField value="abc-123" label="Key" />,
      );
      await checkAccessibility(container);
    });

    it('copy button has aria-label', () => {
      render(<CopyableField value="abc-123" />);
      const buttons = screen.getAllByRole('button');
      const copyButton = buttons.find((btn) => btn.getAttribute('aria-label'));
      expect(copyButton).toHaveAttribute('aria-label');
    });

    it('input is read-only', () => {
      render(<CopyableField value="abc-123" label="Key" />);
      const input = screen.getByDisplayValue('abc-123');
      expect(input).toHaveAttribute('readonly');
    });
  });
});

describe('CopyableText', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<CopyableText value="some-id-123" />);
      await checkAccessibility(container);
    });

    it('copy button has aria-label', () => {
      render(<CopyableText value="some-id-123" />);
      const button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-label');
    });
  });
});
