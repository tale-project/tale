import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Markdown } from '../markdown';
import { CardGroup } from './cards';
import { markdownComponents } from './registry';

describe('CardGroup — cols', () => {
  it('applies the 3-column class for a numeric cols prop', () => {
    const { container } = render(<CardGroup cols={3} />);
    expect(container.querySelector('[class*="lg:grid-cols-3"]')).not.toBeNull();
  });

  it('coerces a string cols prop ("3") to the 3-column class', () => {
    const { container } = render(<CardGroup cols="3" />);
    expect(container.querySelector('[class*="lg:grid-cols-3"]')).not.toBeNull();
  });

  it('renders authored markdown `<CardGroup cols="3">` with three columns', () => {
    // End-to-end through rehype-raw: HTML attributes generally arrive as
    // strings; `cols` specifically may be pre-cast to a number because
    // property-information types it as numeric. Either way the class must
    // land.
    const { container } = render(
      <Markdown components={markdownComponents as never}>
        {'<CardGroup cols="3">\n<Card title="One">First</Card>\n</CardGroup>'}
      </Markdown>,
    );
    expect(container.querySelector('[class*="lg:grid-cols-3"]')).not.toBeNull();
  });

  it('falls back to the 2-column layout without a cols prop', () => {
    const { container } = render(<CardGroup />);
    expect(container.querySelector('[class*="sm:grid-cols-2"]')).not.toBeNull();
  });
});
