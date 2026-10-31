import { describe, expect, it } from 'vitest';

import { readMarketingContent } from './server';

const french = readMarketingContent().filter((page) => page.locale === 'fr');

describe('marketing content voice', () => {
  // Tale says tu to French readers, on these pages as in the product (#4127).
  it('addresses French readers with tu', () => {
    expect(french.length).toBeGreaterThan(0);
    for (const page of french) {
      const text = [
        page.frontmatter.title,
        page.frontmatter.description,
        // Link addresses are not prose: a competitor URL may contain "vos".
        page.content.replaceAll(/\]\([^)]*\)/g, ']'),
      ].join('\n');
      expect(
        text.match(/(?<![\p{L}])(?:vous|votre|vos|vôtres?)(?![\p{L}])/giu),
        page.url,
      ).toBe(null);
    }
  });
});
