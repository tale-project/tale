import { describe, expect, it } from 'vitest';

import { detectListingIntent } from './listing_intent';

/**
 * The contract, table-first: a stuffed listing steers to `list` with the
 * kind/status it names; anything with a surviving noun stays a search. The
 * named utterances come from the design review and must never regress.
 */

describe('detectListingIntent — fires on pure listing language', () => {
  const listings: Array<[string, { kind: string; status?: string }]> = [
    ['list all in-review tasks', { kind: 'task', status: 'in_review' }],
    ['welche Tasks sind in Review', { kind: 'task', status: 'in_review' }],
    ['montre les tâches en revue', { kind: 'task', status: 'in_review' }],
    ['list open tasks', { kind: 'task', status: 'open' }],
    ['show our contacts', { kind: 'contact' }],
    ['list our customers', { kind: 'contact' }],
    ['zeige alle offenen Aufgaben', { kind: 'task', status: 'open' }],
    ['liste des projets', { kind: 'project' }],
    ['show all documents', { kind: 'document' }],
    // A bare state question is a task list with that status.
    ['what is open?', { kind: 'task', status: 'open' }],
    ['was steht im backlog?', { kind: 'task', status: 'backlog' }],
  ];

  it.each(listings)('%s → list', (utterance, expected) => {
    expect(detectListingIntent(utterance)).toEqual(expected);
  });
});

describe('detectListingIntent — honors a search whenever a noun survives', () => {
  const searches = [
    "what's our refund policy",
    'show me the login review task',
    'do we have anything about GDPR?',
    'refund policy',
    'login',
    'tasks about onboarding',
    'which tasks mention the Bergmann account?',
    'list crawled pages of the marketing site', // "crawled"/"marketing" survive
  ];

  it.each(searches)('%s → search', (utterance) => {
    expect(detectListingIntent(utterance)).toBeUndefined();
  });

  it('never proposes the unlistable web-page kind', () => {
    // Pure page-listing language strips clean, but the steer must not point
    // at a kind the executor refuses — the search (and its listing fallback)
    // is the better outcome.
    expect(detectListingIntent('list all pages')).toBeUndefined();
  });

  it('needs two signals, not one', () => {
    expect(detectListingIntent('tasks')).toBeUndefined();
    expect(detectListingIntent('open')).toBeUndefined();
  });

  it('is calm about empty and whitespace queries', () => {
    expect(detectListingIntent('')).toBeUndefined();
    expect(detectListingIntent('   ')).toBeUndefined();
  });
});
