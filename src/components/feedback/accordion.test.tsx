import { fireEvent } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Accordion, AccordionItem } from './accordion';

function fixture() {
  return (
    <Accordion type="single" defaultOpen="a">
      <AccordionItem id="a" question="First question">
        First answer.
      </AccordionItem>
      <AccordionItem id="b" question="Second question">
        Second answer.
      </AccordionItem>
    </Accordion>
  );
}

describe('Accordion', () => {
  it('keeps closed answers in the DOM, hidden from the a11y tree', () => {
    const { getByText } = render(fixture());

    // Open item: visible and not aria-hidden.
    expect(document.getElementById('a-content')).not.toHaveAttribute(
      'aria-hidden',
    );
    // Closed item: text stays mounted (crawlable) but is hidden and inert
    // for assistive tech and keyboard users.
    expect(getByText('Second answer.')).toBeInTheDocument();
    const closed = document.getElementById('b-content');
    expect(closed).toHaveAttribute('aria-hidden', 'true');
    expect(closed).toHaveAttribute('inert');
  });

  it('toggles aria state when a question is activated', () => {
    const { getByRole } = render(fixture());
    const trigger = getByRole('button', { name: 'Second question' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('b-content')).not.toHaveAttribute(
      'aria-hidden',
    );
  });

  it('server-renders closed answers without aria-hidden so crawlers read them', () => {
    // SSR must ship the full Q&A: the markdown transform and search engines
    // drop `aria-hidden="true"` subtrees, so the closed panel's server markup
    // carries neither `aria-hidden` nor `inert` (only the decorative chevron
    // svg stays hidden).
    const html = renderToString(fixture());
    expect(html).toContain('Second answer.');
    expect(html).not.toMatch(/id="b-content"[^>]*aria-hidden/);
    expect(html).not.toContain('inert');
  });

  it('wraps triggers in headings per the WAI-ARIA accordion pattern', () => {
    const { getAllByRole } = render(fixture());
    const headings = getAllByRole('heading', { level: 3 });
    expect(headings).toHaveLength(2);
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(fixture());
      await checkAccessibility(container);
    });
  });
});
