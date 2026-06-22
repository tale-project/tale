import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './tooltip';

describe('Tooltip', () => {
  describe('accessibility', () => {
    it('passes axe audit (trigger)', async () => {
      const { container } = render(
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
});
