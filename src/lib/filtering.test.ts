import { describe, expect, it } from 'vitest';

import { filterByTextSearch } from './filtering';

interface Conversation {
  title: string;
  subject: string;
  customer: { name?: string } | null;
}

const conversations: Conversation[] = [
  {
    title: 'Refund request',
    subject: 'Order #12',
    customer: { name: 'Alice Johnson' },
  },
  {
    title: 'Shipping delay',
    subject: 'Where is it',
    customer: { name: 'Bob Smith' },
  },
  { title: 'General question', subject: 'Hi', customer: null },
];

describe('filterByTextSearch', () => {
  it('returns all items when the search term is empty', () => {
    expect(filterByTextSearch(conversations, '', ['title'])).toHaveLength(3);
    expect(filterByTextSearch(conversations, '   ', ['title'])).toHaveLength(3);
  });

  it('matches a top-level field case-insensitively', () => {
    const results = filterByTextSearch(conversations, 'refund', ['title']);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Refund request');
  });

  it('matches a nested field via an accessor function', () => {
    const results = filterByTextSearch(conversations, 'johnson', [
      (c) => c.customer?.name,
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].customer?.name).toBe('Alice Johnson');
  });

  it('finds the customer name even when no subject/title matches', () => {
    const results = filterByTextSearch(conversations, 'bob', [
      'title',
      'subject',
      (c) => c.customer?.name,
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].customer?.name).toBe('Bob Smith');
  });

  it('does not throw when an accessor resolves to null/undefined', () => {
    const results = filterByTextSearch(conversations, 'alice', [
      (c) => c.customer?.name,
    ]);
    expect(results).toHaveLength(1);
  });

  it('supports startsWith match mode', () => {
    expect(
      filterByTextSearch(
        conversations,
        'ali',
        [(c) => c.customer?.name],
        'startsWith',
      ),
    ).toHaveLength(1);
    expect(
      filterByTextSearch(
        conversations,
        'johnson',
        [(c) => c.customer?.name],
        'startsWith',
      ),
    ).toHaveLength(0);
  });
});
