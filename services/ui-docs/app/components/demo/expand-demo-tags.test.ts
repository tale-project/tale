import { describe, expect, it } from 'vitest';

import { expandDemoTags } from './expand-demo-tags';

describe('expandDemoTags', () => {
  it('expands a self-closing demo tag into a block-level pair', () => {
    expect(expandDemoTags('<Demo name="button/variants" />')).toBe(
      '<Demo name="button/variants">\n</Demo>',
    );
  });

  it('keeps the content after the first demo out of the demo', () => {
    const page = [
      '## Variants',
      '',
      '<Demo name="button/variants" />',
      '',
      '## Sizes',
      '',
      '<Demo name="button/sizes"/>',
    ].join('\n');
    expect(expandDemoTags(page)).toBe(
      [
        '## Variants',
        '',
        '<Demo name="button/variants">',
        '</Demo>',
        '',
        '## Sizes',
        '',
        '<Demo name="button/sizes">',
        '</Demo>',
      ].join('\n'),
    );
  });

  it('leaves an already paired tag and fenced code untouched', () => {
    const page = [
      '<Demo name="a">',
      '</Demo>',
      '```md',
      '<Demo name="shown-as-syntax" />',
      '```',
      '~~~',
      '<Demo name="also-shown" />',
      '~~~',
    ].join('\n');
    expect(expandDemoTags(page)).toBe(page);
  });
});
