import { describe, expect, it } from 'vitest';

import {
  MAX_FOLLOW_UP_ITEMS,
  MAX_FOLLOW_UP_LENGTH,
  parseFollowUpItems,
} from './parse-follow-up-items';

describe('parseFollowUpItems', () => {
  it('returns empty array for empty content', () => {
    expect(parseFollowUpItems('')).toEqual([]);
  });

  it('parses valid follow-up items', () => {
    const content = 'Compare Q3 vs Q4 revenue\nAnalyze competitor pricing';
    expect(parseFollowUpItems(content)).toEqual([
      'Compare Q3 vs Q4 revenue',
      'Analyze competitor pricing',
    ]);
  });

  it('trims whitespace from items', () => {
    const content = '  Item one  \n  Item two  ';
    expect(parseFollowUpItems(content)).toEqual(['Item one', 'Item two']);
  });

  it('filters out empty lines', () => {
    const content = 'Item one\n\n\nItem two\n';
    expect(parseFollowUpItems(content)).toEqual(['Item one', 'Item two']);
  });

  it('filters out items exceeding max length', () => {
    const short = 'Short item';
    const exact = 'A'.repeat(MAX_FOLLOW_UP_LENGTH);
    const tooLong = 'A'.repeat(MAX_FOLLOW_UP_LENGTH + 1);

    const content = [short, exact, tooLong].join('\n');
    expect(parseFollowUpItems(content)).toEqual([short, exact]);
  });

  it('limits to max number of items', () => {
    const items = Array.from({ length: 8 }, (_, i) => `Item ${i + 1}`);
    const content = items.join('\n');

    const result = parseFollowUpItems(content);
    expect(result).toHaveLength(MAX_FOLLOW_UP_ITEMS);
    expect(result).toEqual(items.slice(0, MAX_FOLLOW_UP_ITEMS));
  });

  it('filters long items before applying item limit', () => {
    const longItem =
      'This is a very long follow-up item that exceeds the maximum allowed character length for buttons';
    const content = [longItem, 'Valid item 1', 'Valid item 2'].join('\n');

    const result = parseFollowUpItems(content);
    expect(result).toEqual(['Valid item 1', 'Valid item 2']);
  });

  it('filters out lines with markdown formatting', () => {
    const content = [
      'Valid plain text item',
      '**Bold text item**',
      '| Table | Row |',
      '# Heading',
      '- Bulleted item',
      '1. Numbered item',
      '`code snippet`',
      '> Blockquote',
      '[Link text](url)',
      'Another valid item',
    ].join('\n');

    expect(parseFollowUpItems(content)).toEqual([
      'Valid plain text item',
      'Another valid item',
    ]);
  });

  it('handles the real-world AI overflow case', () => {
    const content = [
      'Deep dive into SEALSQ semiconductor subsidiary',
      'Analyze WISeSat satellite IoT economics',
      'Review SEC filings for financial details',
      'Compare Wisekey to cybersecurity competitors  Based on the research already conducted, here are the **six recommended perspectives** for analyzing Wisekey:\n\n| Perspective | Focus Area | Key Questions |',
    ].join('\n');

    const result = parseFollowUpItems(content);
    expect(result).toEqual([
      'Deep dive into SEALSQ semiconductor subsidiary',
      'Analyze WISeSat satellite IoT economics',
      'Review SEC filings for financial details',
    ]);
  });
});
