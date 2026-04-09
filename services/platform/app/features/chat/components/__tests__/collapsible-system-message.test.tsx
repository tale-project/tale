import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CollapsibleSystemMessage } from '../collapsible-system-message';

describe('CollapsibleSystemMessage', () => {
  describe('accessibility', () => {
    it('passes axe audit with info variant', async () => {
      const { container } = render(
        <CollapsibleSystemMessage
          content="System message line one\nSystem message line two\nSystem message line three"
          variant="info"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with warning variant', async () => {
      const { container } = render(
        <CollapsibleSystemMessage
          content="Warning message content"
          variant="warning"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with error variant', async () => {
      const { container } = render(
        <CollapsibleSystemMessage
          content="Error message content"
          variant="error"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with success variant', async () => {
      const { container } = render(
        <CollapsibleSystemMessage
          content="Success message content"
          variant="success"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
