import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render as renderWithProviders } from '@/tests/utils/render';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

describe('Tooltip', () => {
  describe('accessibility', () => {
    it('passes axe audit (trigger)', async () => {
      const { container } = renderWithProviders(
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Hover me</TooltipTrigger>
            <TooltipContent>Helpful hint</TooltipContent>
          </Tooltip>
        </TooltipProvider>,
      );
      await checkAccessibility(container);
    });
  });

  it('caps tooltip width so long prose wraps instead of spanning the viewport', () => {
    const longCopy =
      'Runs in a sandbox on the harness chosen when the agent was created, pre-equipped with its skills, connectors, and instructions.';

    render(
      <TooltipProvider>
        <Tooltip open onOpenChange={() => {}}>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>{longCopy}</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    const content = document.querySelector(
      '[data-state="instant-open"].max-w-xs',
    );
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain(longCopy);
  });
});
