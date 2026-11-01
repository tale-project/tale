import { describe, expect, it } from 'vitest';

import { composeDesiredMembers } from './internal_mutations';
import { parseGroupPatch } from './mappers';

/**
 * A Group PATCH's member operations apply one at a time, in the order the
 * request sent them, each to the members the one before left (RFC 7644
 * §3.5.2). Folded into sets they lost that order: a member removed and added
 * back lost the team, and an add followed by a clear-all stayed in it (#4774).
 */
const compose = (current: string[], Operations: unknown[]) =>
  composeDesiredMembers(
    current,
    parseGroupPatch({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations,
    }).memberOperations,
  );

const sorted = (ids: string[]) => [...ids].sort();

describe('composeDesiredMembers — a Group PATCH applies its operations in order [SCIM-R10]', () => {
  it('replace [u1, u2], remove u1, add u1 back ends with u1 and u2', () => {
    const desired = compose(
      ['u0'],
      [
        {
          op: 'replace',
          path: 'members',
          value: [{ value: 'u1' }, { value: 'u2' }],
        },
        { op: 'remove', path: 'members[value eq "u1"]' },
        { op: 'add', path: 'members', value: [{ value: 'u1' }] },
      ],
    );
    expect(sorted(desired)).toEqual(['u1', 'u2']);
  });

  it('replace [u1], remove u1, add u3 ends with u3 alone', () => {
    const desired = compose(
      ['u0'],
      [
        { op: 'replace', path: 'members', value: [{ value: 'u1' }] },
        { op: 'remove', path: 'members[value eq "u1"]' },
        { op: 'add', path: 'members', value: [{ value: 'u3' }] },
      ],
    );
    expect(desired).toEqual(['u3']);
  });

  it('an add followed by a value-less remove of members ends with no members', () => {
    const desired = compose(
      ['u1'],
      [
        { op: 'add', path: 'members', value: [{ value: 'u3' }] },
        { op: 'remove', path: 'members' },
      ],
    );
    expect(desired).toEqual([]);
  });

  it('a value-less remove of members followed by an add keeps the add (#2085[13])', () => {
    const desired = compose(
      ['u1'],
      [
        { op: 'remove', path: 'members' },
        { op: 'add', path: 'members', value: [{ value: 'u3' }] },
      ],
    );
    expect(desired).toEqual(['u3']);
  });

  it('keeps a member who is removed and added back', () => {
    const desired = compose(
      ['u1', 'u2'],
      [
        { op: 'remove', path: 'members[value eq "u1"]' },
        { op: 'add', path: 'members', value: [{ value: 'u1' }] },
      ],
    );
    expect(sorted(desired)).toEqual(['u1', 'u2']);
  });

  it('leaves out a new member who is added and then removed', () => {
    const desired = compose(
      ['u1'],
      [
        { op: 'add', path: 'members', value: [{ value: 'u3' }] },
        { op: 'remove', path: 'members[value eq "u3"]' },
      ],
    );
    expect(desired).toEqual(['u1']);
  });

  it('leaves the current members as they are when no operation names members', () => {
    const desired = compose(
      ['u2', 'u1'],
      [{ op: 'replace', path: 'displayName', value: 'Platform' }],
    );
    expect(sorted(desired)).toEqual(['u1', 'u2']);
  });
});
