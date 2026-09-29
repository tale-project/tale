import { describe, expect, it } from 'vitest';

import { BackendApiError } from '@/app/lib/backend/api-client';

import { readFailureMessage, skillReadState } from './skill-read-state';

const outage = new BackendApiError(503, 'Service Unavailable');

describe('skillReadState', () => {
  it('is loading until the first answer, a retried failure included', () => {
    // react-query puts a query with no data back to `pending` for each fetch.
    expect(
      skillReadState({ data: undefined, error: null, isError: false }),
    ).toEqual({ status: 'loading' });
  });

  it('is failed when the read settled with nothing to show', () => {
    expect(
      skillReadState({ data: undefined, error: outage, isError: true }),
    ).toEqual({ status: 'failed', error: outage });
  });

  it("keeps the door's null apart from a failure", () => {
    expect(skillReadState({ data: null, error: null, isError: false })).toEqual(
      { status: 'ready', data: null, refreshFailed: false },
    );
  });

  it('keeps a shown answer whose refresh failed, through its retry', () => {
    // With data, react-query keeps the error while the query is fetched again.
    expect(
      skillReadState({ data: { body: '' }, error: outage, isError: true }),
    ).toEqual({ status: 'ready', data: { body: '' }, refreshFailed: true });
  });
});

describe('readFailureMessage', () => {
  it("adds nothing for a fault, and a lost connection's sentence", () => {
    expect(readFailureMessage("Couldn't load this skill.", outage)).toBe(
      "Couldn't load this skill.",
    );
    expect(
      readFailureMessage(
        "Couldn't load this skill.",
        new TypeError('Failed to fetch'),
      ),
    ).toBe(
      "Couldn't load this skill. Couldn't reach Tale. Check your connection and try again.",
    );
  });
});
