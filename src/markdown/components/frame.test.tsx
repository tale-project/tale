import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Markdown } from '../markdown';
import { markdownComponents } from './registry';

describe('Frame in authored Markdown', () => {
  it.each(['Frame', 'frame'])(
    'preserves the %s caption, image and following paragraph',
    (tag) => {
      const { container } = render(
        <Markdown components={markdownComponents as never}>
          {`<${tag} caption="Indexed uploads &amp; team access">\n\n![Shared source files.](/images/documents.webp)\n\n</${tag}>\n\nContinue with the upload steps.`}
        </Markdown>,
      );
      const figure = container.querySelector('figure');
      expect(figure).not.toBeNull();
      expect(figure?.querySelector('figcaption')?.textContent).toBe(
        'Indexed uploads & team access',
      );
      expect(figure?.querySelector('img')?.alt).toBe('Shared source files.');
      expect(
        screen.getByText('Continue with the upload steps.').closest('figure'),
      ).toBeNull();
    },
  );

  it('preserves literal component examples and caption text', () => {
    const { container } = render(
      <Markdown components={markdownComponents as never}>
        {
          '<Frame caption="Use <Frame> for an image.">\n\nA visible example.\n\n</Frame>\n\n`<Frame>`\n\n```html\n<Frame caption="Example">\n</Frame>\n```'
        }
      </Markdown>,
    );
    expect(container.querySelector('figcaption')?.textContent).toBe(
      'Use <Frame> for an image.',
    );
    expect(container.querySelector('code')?.textContent).toBe('<Frame>');
    expect(container.querySelector('pre')?.textContent).toContain(
      '<Frame caption="Example">',
    );
  });
});
