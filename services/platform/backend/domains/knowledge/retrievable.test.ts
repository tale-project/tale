import { describe, expect, it } from 'vitest';

import {
  decideRetrievable,
  type DocCandidate,
  type UnboundFileCandidate,
} from './retrievable.ts';

const activeDoc = (overrides: Partial<DocCandidate> = {}): DocCandidate => ({
  lifecycleStatus: null,
  projectId: null,
  teamId: null,
  teamTags: null,
  ...overrides,
});

const unboundFile = (
  overrides: Partial<UnboundFileCandidate> = {},
): UnboundFileCandidate => ({
  lifecycleStatus: null,
  threadId: null,
  ...overrides,
});

describe('decideRetrievable', () => {
  it('denies a ref with no candidates (replaced/rotated history, purged rows)', () => {
    expect(decideRetrievable([], [], undefined)).toBe(false);
  });

  it('admits a current, active document without an access scope', () => {
    expect(decideRetrievable([activeDoc()], [], undefined)).toBe(true);
  });

  it('denies trashed and expired documents — lifecycle truth beats the physical purge', () => {
    for (const lifecycleStatus of ['trashed', 'expired', 'purge_pending']) {
      expect(
        decideRetrievable([activeDoc({ lifecycleStatus })], [], undefined),
      ).toBe(false);
    }
  });

  it('scopes a project document to the granted projects', () => {
    const doc = activeDoc({ projectId: 'p1' });
    expect(decideRetrievable([doc], [], { projectIds: ['p1'] })).toBe(true);
    expect(decideRetrievable([doc], [], { projectIds: ['p2'] })).toBe(false);
    expect(decideRetrievable([doc], [], {})).toBe(false);
  });

  it('scopes hub documents by team, honoring includeHub', () => {
    const teamDoc = activeDoc({ teamId: 't1' });
    expect(decideRetrievable([teamDoc], [], { teamIds: ['t1'] })).toBe(true);
    expect(decideRetrievable([teamDoc], [], { teamIds: ['t2'] })).toBe(false);
    expect(
      decideRetrievable([teamDoc], [], { teamIds: ['t1'], includeHub: false }),
    ).toBe(false);
    // Teamless hub documents are org-wide.
    expect(decideRetrievable([activeDoc()], [], { teamIds: [] })).toBe(true);
    // team_tags outrank the deprecated single team column.
    const tagged = activeDoc({ teamId: 't1', teamTags: ['t2', 't3'] });
    expect(decideRetrievable([tagged], [], { teamIds: ['t1'] })).toBe(false);
    expect(decideRetrievable([tagged], [], { teamIds: ['t3'] })).toBe(true);
  });

  it('lets a live COPY twin admit through its own scope after the sibling dies', () => {
    const trashedTwin = activeDoc({ lifecycleStatus: 'trashed' });
    const liveTwin = activeDoc({ projectId: 'p1' });
    expect(
      decideRetrievable([trashedTwin, liveTwin], [], { projectIds: ['p1'] }),
    ).toBe(true);
    expect(decideRetrievable([trashedTwin], [], { projectIds: ['p1'] })).toBe(
      false,
    );
  });

  it('scopes thread files to their thread and honors the conversation switch', () => {
    const threadFile = unboundFile({ threadId: 'th1' });
    expect(decideRetrievable([], [threadFile], undefined)).toBe(true);
    expect(decideRetrievable([], [threadFile], { threadIds: ['th1'] })).toBe(
      true,
    );
    expect(decideRetrievable([], [threadFile], { threadIds: ['th2'] })).toBe(
      false,
    );
    expect(
      decideRetrievable([], [threadFile], {
        threadIds: ['th1'],
        includeConversationScoped: false,
      }),
    ).toBe(false);
  });

  it('keeps the same-org posture for live document-less rows (video-link lane)', () => {
    expect(decideRetrievable([], [unboundFile()], { teamIds: [] })).toBe(true);
  });

  it('denies trashed unbound rows — the WebDAV overwrite strands', () => {
    expect(
      decideRetrievable(
        [],
        [unboundFile({ lifecycleStatus: 'trashed' })],
        undefined,
      ),
    ).toBe(false);
  });
});
