import { describe, expect, it } from 'vitest';

import {
  audienceMatcher,
  MY_TEAMS_AUDIENCE,
  ORG_WIDE_AUDIENCE,
  parseAudienceFilter,
  serializeAudienceFilter,
} from './audience-filter';

/**
 * The Teams filter every audience-scoped list shares: the URL spelling of a
 * selection and the predicate a row's audience answers to.
 */
describe('audience filter', () => {
  it('round-trips the URL spelling and drops blanks', () => {
    expect(parseAudienceFilter(undefined)).toEqual([]);
    expect(parseAudienceFilter('')).toEqual([]);
    expect(parseAudienceFilter('org,,team-a,')).toEqual(['org', 'team-a']);
    expect(serializeAudienceFilter([])).toBeUndefined();
    expect(serializeAudienceFilter(['mine', 'team-a'])).toBe('mine,team-a');
    expect(
      parseAudienceFilter(serializeAudienceFilter([ORG_WIDE_AUDIENCE, 't1'])),
    ).toEqual([ORG_WIDE_AUDIENCE, 't1']);
  });

  it('matches organization-wide rows only for the Organization-wide token', () => {
    const matches = audienceMatcher([ORG_WIDE_AUDIENCE], ['t-mine']);
    expect(matches([])).toBe(true);
    expect(matches(undefined)).toBe(true);
    expect(matches(['t-mine'])).toBe(false);
  });

  it('expands My teams to the viewer’s own teams and nothing else', () => {
    const matches = audienceMatcher([MY_TEAMS_AUDIENCE], ['t-mine']);
    expect(matches(['t-other', 't-mine'])).toBe(true);
    expect(matches(['t-other'])).toBe(false);
    // An organization-wide row is not "one of my teams".
    expect(matches([])).toBe(false);
    // A viewer in no team matches nothing team-scoped.
    expect(audienceMatcher([MY_TEAMS_AUDIENCE], [])(['t-other'])).toBe(false);
  });

  it('matches a named team, and ANY of several selected values', () => {
    const matches = audienceMatcher([ORG_WIDE_AUDIENCE, 't-named'], ['t-mine']);
    expect(matches([])).toBe(true);
    expect(matches(['t-named', 't-other'])).toBe(true);
    expect(matches(['t-mine'])).toBe(false);
    expect(matches(['t-other'])).toBe(false);
  });
});
