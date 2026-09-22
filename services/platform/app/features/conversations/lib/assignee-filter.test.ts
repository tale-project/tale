import { describe, expect, it } from 'vitest';

import {
  ASSIGNEE_ME,
  ASSIGNEE_MY_TEAMS,
  ASSIGNEE_UNASSIGNED,
  buildAssigneeOptions,
  matchesAssigneeFilter,
  type AssignedRow,
} from './assignee-filter';

const viewer = {
  currentUserId: 'user-me',
  myTeamIds: new Set(['team-billing']),
};

const labels = {
  people: 'People',
  teams: 'Teams',
  unknownPerson: 'Unknown person',
  unknownTeam: 'Unknown team',
};

const rows = {
  mine: { assigneeUserId: 'user-me' },
  theirs: { assigneeUserId: 'user-dana' },
  myTeam: { assigneeTeamId: 'team-billing' },
  otherTeam: { assigneeTeamId: 'team-support' },
  both: { assigneeUserId: 'user-dana', assigneeTeamId: 'team-support' },
  unassigned: {},
} satisfies Record<string, AssignedRow>;

describe('matchesAssigneeFilter', () => {
  it('narrows nothing when no value is selected', () => {
    for (const row of Object.values(rows)) {
      expect(matchesAssigneeFilter(row, [], viewer)).toBe(true);
    }
  });

  it('matches a conversation the viewer claimed personally', () => {
    expect(matchesAssigneeFilter(rows.mine, [ASSIGNEE_ME], viewer)).toBe(true);
    expect(matchesAssigneeFilter(rows.theirs, [ASSIGNEE_ME], viewer)).toBe(
      false,
    );
  });

  it('matches nothing under "me" while the member context is still loading', () => {
    expect(
      matchesAssigneeFilter(rows.mine, [ASSIGNEE_ME], {
        myTeamIds: viewer.myTeamIds,
      }),
    ).toBe(false);
  });

  it('does not treat a team queue the viewer belongs to as theirs personally', () => {
    // The distinction the old queue filter could not draw: sitting in my
    // team's queue is not the same as me having claimed it.
    expect(matchesAssigneeFilter(rows.myTeam, [ASSIGNEE_ME], viewer)).toBe(
      false,
    );
  });

  it('matches the viewer’s own team queues', () => {
    expect(
      matchesAssigneeFilter(rows.myTeam, [ASSIGNEE_MY_TEAMS], viewer),
    ).toBe(true);
    expect(
      matchesAssigneeFilter(rows.otherTeam, [ASSIGNEE_MY_TEAMS], viewer),
    ).toBe(false);
  });

  it('counts a row as unassigned only when BOTH stamps are empty', () => {
    expect(
      matchesAssigneeFilter(rows.unassigned, [ASSIGNEE_UNASSIGNED], viewer),
    ).toBe(true);
    // Someone claimed it — it is not waiting in triage.
    expect(
      matchesAssigneeFilter(rows.theirs, [ASSIGNEE_UNASSIGNED], viewer),
    ).toBe(false);
    expect(
      matchesAssigneeFilter(rows.myTeam, [ASSIGNEE_UNASSIGNED], viewer),
    ).toBe(false);
  });

  it('matches a bare id against either stamp', () => {
    expect(matchesAssigneeFilter(rows.theirs, ['user-dana'], viewer)).toBe(
      true,
    );
    expect(
      matchesAssigneeFilter(rows.otherTeam, ['team-support'], viewer),
    ).toBe(true);
    expect(matchesAssigneeFilter(rows.mine, ['user-dana'], viewer)).toBe(false);
  });

  it('ORs the selection rather than intersecting it', () => {
    const selection = [ASSIGNEE_ME, 'team-support'];
    expect(matchesAssigneeFilter(rows.mine, selection, viewer)).toBe(true);
    expect(matchesAssigneeFilter(rows.otherTeam, selection, viewer)).toBe(true);
    // Satisfies neither.
    expect(matchesAssigneeFilter(rows.myTeam, selection, viewer)).toBe(false);
  });

  it('keeps a row that satisfies one half of a two-stamp assignment', () => {
    expect(matchesAssigneeFilter(rows.both, ['user-dana'], viewer)).toBe(true);
    expect(matchesAssigneeFilter(rows.both, ['team-support'], viewer)).toBe(
      true,
    );
  });
});

describe('buildAssigneeOptions', () => {
  const personNameOf = (id: string) =>
    ({ 'user-me': 'Zoe A.', 'user-dana': 'Dana K.' })[id];
  const teamNameOf = (id: string) =>
    ({ 'team-billing': 'Billing', 'team-support': 'Support' })[id];

  it('offers only the assignees present on the loaded rows', () => {
    const options = buildAssigneeOptions({
      rows: [rows.theirs, rows.otherTeam],
      selected: [],
      personNameOf,
      teamNameOf,
      labels,
    });

    expect(options).toEqual([
      { value: 'user-dana', label: 'Dana K.', group: 'People' },
      { value: 'team-support', label: 'Support', group: 'Teams' },
    ]);
  });

  it('groups people before teams and sorts each group by name', () => {
    const options = buildAssigneeOptions({
      rows: [rows.otherTeam, rows.mine, rows.myTeam, rows.theirs],
      selected: [],
      personNameOf,
      teamNameOf,
      labels,
    });

    expect(options.map((option) => option.label)).toEqual([
      'Dana K.',
      'Zoe A.',
      'Billing',
      'Support',
    ]);
    expect(options.map((option) => option.group)).toEqual([
      'People',
      'People',
      'Teams',
      'Teams',
    ]);
  });

  it('lists an assignee once however many rows carry it', () => {
    const options = buildAssigneeOptions({
      rows: [rows.theirs, rows.theirs, rows.both],
      selected: [],
      personNameOf,
      teamNameOf,
      labels,
    });

    expect(options.filter((o) => o.value === 'user-dana')).toHaveLength(1);
  });

  it('keeps a selected assignee that has left the loaded rows', () => {
    // Otherwise a reloaded `?assignee=` link shows an empty panel over a list
    // it is visibly narrowing.
    const options = buildAssigneeOptions({
      rows: [rows.unassigned],
      selected: ['user-dana', 'team-support'],
      personNameOf,
      teamNameOf,
      labels,
    });

    expect(options).toEqual([
      { value: 'user-dana', label: 'Dana K.', group: 'People' },
      { value: 'team-support', label: 'Support', group: 'Teams' },
    ]);
  });

  it('never turns a sentinel into an option', () => {
    const options = buildAssigneeOptions({
      rows: [],
      selected: [ASSIGNEE_ME, ASSIGNEE_UNASSIGNED, ASSIGNEE_MY_TEAMS],
      personNameOf,
      teamNameOf,
      labels,
    });

    expect(options).toEqual([]);
  });

  it('falls back to a placeholder when a directory cannot name an id', () => {
    const options = buildAssigneeOptions({
      rows: [{ assigneeUserId: 'user-gone' }, { assigneeTeamId: 'team-gone' }],
      selected: [],
      personNameOf,
      teamNameOf,
      labels,
    });

    expect(options).toEqual([
      { value: 'user-gone', label: 'Unknown person', group: 'People' },
      { value: 'team-gone', label: 'Unknown team', group: 'Teams' },
    ]);
  });
});
