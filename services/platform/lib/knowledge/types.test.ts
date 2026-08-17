import { describe, expect, it } from 'vitest';

import {
  type DocumentScopeStamp,
  documentScopeKind,
  type KnowledgeAccessScope,
  knowledgeScopeAllows,
  scopeTeamIds,
} from './types';

/** A caller with no teams and no projects, who may read hub rows. */
const hubOnly: KnowledgeAccessScope = {
  teamIds: [],
  projectIds: [],
  includeHub: true,
};

describe('scopeTeamIds', () => {
  it('prefers the full list over the deprecated single stamp', () => {
    expect(
      scopeTeamIds({ teamId: 'team_a', teamIds: ['team_b', 'team_c'] }),
    ).toEqual(['team_b', 'team_c']);
  });

  it('reads a row carrying only the legacy stamp as a one-team list', () => {
    expect(scopeTeamIds({ teamId: 'team_a' })).toEqual(['team_a']);
  });

  it('is empty for a row with neither', () => {
    expect(scopeTeamIds({})).toEqual([]);
  });

  it('treats an explicitly empty list as empty, not as a legacy fallback', () => {
    // `teamTags: []` is a real state (teams cleared) and must not resurrect a
    // stale single stamp.
    expect(scopeTeamIds({ teamId: 'team_a', teamIds: [] })).toEqual([]);
  });
});

describe('documentScopeKind', () => {
  it('classifies a row with no teams and no project as hub', () => {
    expect(documentScopeKind({})).toBe('hub');
  });

  it('classifies a team row as teams', () => {
    expect(documentScopeKind({ teamIds: ['team_a'] })).toBe('teams');
  });

  // The defect in #2989: `teamIds.length === 0` reads as "unscoped", but it is
  // also true of every project-scoped row — so the Documents table rendered
  // "Organization-wide" for material that is restricted to one project.
  it('classifies a project row as project, never hub', () => {
    expect(documentScopeKind({ projectId: 'project_a' })).toBe('project');
    expect(documentScopeKind({ projectId: 'project_a', teamIds: [] })).toBe(
      'project',
    );
  });

  // The reachable sibling of the same mistake: reading only `teamTags` misses a
  // row written before multi-team support, which access control still restricts
  // through the single stamp (`hasTeamAccess`).
  it('classifies a legacy single-stamp row as teams, never hub', () => {
    expect(documentScopeKind({ teamId: 'team_a' })).toBe('teams');
  });
});

describe('documentScopeKind agrees with knowledgeScopeAllows', () => {
  const stamps: ReadonlyArray<readonly [string, DocumentScopeStamp]> = [
    ['no stamps at all', {}],
    ['explicitly empty teams', { teamIds: [] }],
    ['null stamps', { teamId: null, teamIds: null, projectId: null }],
    ['a team list', { teamIds: ['team_a'] }],
    ['a legacy single team', { teamId: 'team_a' }],
    ['a project', { projectId: 'project_a' }],
    ['a project with empty teams', { projectId: 'project_a', teamIds: [] }],
  ];

  // The label and the access rules must answer "is this organization-wide?"
  // identically. Pinned behaviourally rather than by comment: a hub-only caller
  // can read exactly the rows `documentScopeKind` calls 'hub', so a label that
  // says "Organization-wide" for anything else is claiming access the rules
  // refuse.
  it.each(stamps)('%s', (_name, scope) => {
    expect(knowledgeScopeAllows(hubOnly, scope)).toBe(
      documentScopeKind(scope) === 'hub',
    );
  });

  it('does not let includeHub grant a scoped row', () => {
    for (const scope of [
      { teamIds: ['team_a'] },
      { teamId: 'team_a' },
      { projectId: 'project_a' },
    ] satisfies DocumentScopeStamp[]) {
      expect(knowledgeScopeAllows(hubOnly, scope)).toBe(false);
    }
  });

  it('still grants a scoped row to a caller holding that scope', () => {
    expect(
      knowledgeScopeAllows(
        { teamIds: ['team_a'], projectIds: [], includeHub: false },
        { teamId: 'team_a' },
      ),
    ).toBe(true);
    expect(
      knowledgeScopeAllows(
        { teamIds: [], projectIds: ['project_a'], includeHub: false },
        { projectId: 'project_a' },
      ),
    ).toBe(true);
  });

  it('treats an absent access scope as org-wide, whatever the stamp', () => {
    expect(knowledgeScopeAllows(undefined, { projectId: 'project_a' })).toBe(
      true,
    );
  });
});
