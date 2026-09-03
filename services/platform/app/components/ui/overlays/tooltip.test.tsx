// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render as renderWithProviders } from '@/tests/utils/render';

import { Tooltip, tooltipContentClassName } from './tooltip';

describe('Tooltip', () => {
  describe('accessibility', () => {
    it('passes axe audit with trigger visible', async () => {
      const { container } = renderWithProviders(
        <Tooltip content="Helpful tip">
          <button>Hover me</button>
        </Tooltip>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when content is empty (renders children only)', async () => {
      const { container } = renderWithProviders(
        <Tooltip content="">
          <button>No tooltip</button>
        </Tooltip>,
      );
      await checkAccessibility(container);
    });
  });

  it('caps tooltip width so long prose wraps instead of spanning the viewport', () => {
    const longCopy =
      'Runs in a sandbox on the harness chosen when the agent was created, pre-equipped with its skills, connectors, and instructions.';

    render(
      <Tooltip content={longCopy} open onOpenChange={() => {}}>
        <button type="button">Info</button>
      </Tooltip>,
    );

    const content = document.querySelector(
      '[data-state="instant-open"].max-w-xs',
    );
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain(longCopy);
    expect(tooltipContentClassName).toContain('text-wrap');
  });
});
