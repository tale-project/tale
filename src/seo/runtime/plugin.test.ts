import { describe, expect, it } from 'vitest';

import { llmsTxtPlugin } from '../plugins/llms-txt';
import { pageMarkdownPlugin } from '../plugins/page-markdown';
import { pluginMatches } from './plugin';

describe('pluginMatches', () => {
  it('uses string equality for literal-match plugins', () => {
    expect(pluginMatches(llmsTxtPlugin, '/llms.txt')).toBe(true);
    expect(pluginMatches(llmsTxtPlugin, '/llms.txt/')).toBe(false);
    expect(pluginMatches(llmsTxtPlugin, '/other')).toBe(false);
  });

  it('calls the predicate for predicate-match plugins', () => {
    expect(pluginMatches(pageMarkdownPlugin, '/pricing.md')).toBe(true);
    expect(pluginMatches(pageMarkdownPlugin, '/de/legal/imprint.md')).toBe(
      true,
    );
    expect(pluginMatches(pageMarkdownPlugin, '/pricing')).toBe(false);
  });
});
