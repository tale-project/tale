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
  folderPath: null,
  ...overrides,
});

const unboundFile = (
  overrides: Partial<UnboundFileCandidate> = {},
): UnboundFileCandidate => ({
  lifecycleStatus: null,
  threadId: null,
  conversationId: null,
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

  it('denies a live row bound to neither a document nor a thread', () => {
    // This replaces an assertion that admitted the same shape same-org. The
    // corpus stamps no project and no team for a row with no document, and
    // the SQL half reads that as org-wide — so admitting it here served one
    // member's file to the whole organization. 0.4 denied it too.
    expect(decideRetrievable([], [unboundFile()], { teamIds: [] })).toBe(false);
  });

  it('denies it with no access scope either', () => {
    // `access === undefined` is the internal-caller path; it must not become
    // a way around the rule above.
    expect(decideRetrievable([], [unboundFile()], undefined)).toBe(false);
  });

  it('still admits the video-link lane once its thread is stamped', () => {
    // The reason the old assertion gave for admitting unbound rows was that
    // video-link transcripts index without a document. They do — with a
    // thread. A welcome-page paste starts thread-less because no thread
    // exists yet, and the first send stamps it (`bindStorageIdsToThread`
    // updates exactly the rows with no document and no thread), after which
    // this branch admits it.
    expect(
      decideRetrievable([], [unboundFile({ threadId: 'thread_1' })], {
        teamIds: [],
        threadIds: ['thread_1'],
      }),
    ).toBe(true);
  });

  it('does not admit a thread-bound row from outside its thread', () => {
    expect(
      decideRetrievable([], [unboundFile({ threadId: 'thread_1' })], {
        teamIds: [],
        threadIds: ['thread_2'],
      }),
    ).toBe(false);
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

  describe('folder filter', () => {
    // The corpus row's folder stamp is a copy that can lag a move; the
    // decision is made from the document's CURRENT folder.
    it('admits the folder itself and everything beneath it', () => {
      expect(
        decideRetrievable(
          [activeDoc({ folderPath: 'Reports' })],
          [],
          undefined,
          'Reports',
        ),
      ).toBe(true);
      expect(
        decideRetrievable(
          [activeDoc({ folderPath: 'Reports/2025/Q1' })],
          [],
          undefined,
          'Reports',
        ),
      ).toBe(true);
    });

    it('denies siblings, prefixes without a separator, and root documents', () => {
      expect(
        decideRetrievable(
          [activeDoc({ folderPath: 'Reports-archive' })],
          [],
          undefined,
          'Reports',
        ),
      ).toBe(false);
      expect(
        decideRetrievable(
          [activeDoc({ folderPath: 'Invoices' })],
          [],
          undefined,
          'Reports',
        ),
      ).toBe(false);
      expect(decideRetrievable([activeDoc()], [], undefined, 'Reports')).toBe(
        false,
      );
    });

    it('applies the access scope on top of the folder', () => {
      const doc = activeDoc({ folderPath: 'Reports', teamId: 't1' });
      expect(decideRetrievable([doc], [], { teamIds: ['t1'] }, 'Reports')).toBe(
        true,
      );
      expect(decideRetrievable([doc], [], { teamIds: ['t2'] }, 'Reports')).toBe(
        false,
      );
    });

    it('never surfaces unbound files under a folder filter — they are filed nowhere', () => {
      expect(decideRetrievable([], [unboundFile()], undefined, 'Reports')).toBe(
        false,
      );
      expect(
        decideRetrievable(
          [],
          [unboundFile({ threadId: 'th1' })],
          { threadIds: ['th1'] },
          'Reports',
        ),
      ).toBe(false);
    });

    it('is a no-op when no folder is given', () => {
      expect(
        decideRetrievable(
          [activeDoc({ folderPath: 'Reports' })],
          [],
          undefined,
        ),
      ).toBe(true);
      // A thread-bound file, because a row bound to NEITHER a document nor
      // a thread is denied on its own merits — see the deny tests above. The
      // claim here is that the absent folder changes nothing, so the fixture
      // has to be one that admits without it.
      expect(
        decideRetrievable([], [unboundFile({ threadId: 'th1' })], undefined),
      ).toBe(true);
    });
  });
});

/**
 * An emailed attachment is scoped by the CONVERSATION it arrived on, and
 * conversations are scoped more narrowly than anything else the platform
 * retrieves: an unassigned inbox row is admin-triage only. So the caller
 * supplies the conversations it may read (already decided by
 * `conversationAssignmentAllows`) rather than this decision deriving them
 * from org membership — a second copy of that rule is how a reader ends up
 * publishing an inbox.
 */
describe('decideRetrievable — the conversation branch', () => {
  const mail = (conversationId: string) =>
    unboundFile({ conversationId, threadId: null });

  it('admits an attachment whose conversation the caller may read', () => {
    expect(
      decideRetrievable([], [mail('conv_1')], { conversationIds: ['conv_1'] }),
    ).toBe(true);
  });

  it('denies one whose conversation the caller may not read', () => {
    // The row exists and is alive; the caller simply is not on that inbox
    // row. Org membership must not be enough.
    expect(
      decideRetrievable([], [mail('conv_2')], { conversationIds: ['conv_1'] }),
    ).toBe(false);
  });

  it('denies when the caller has no conversations at all', () => {
    expect(decideRetrievable([], [mail('conv_1')], {})).toBe(false);
  });

  it('is not widened by team or project scope', () => {
    // The document branches' scope says nothing about an inbox row — a
    // member of every team still sees only their own conversations.
    expect(
      decideRetrievable([], [mail('conv_1')], {
        teamIds: ['team_a'],
        projectIds: ['proj_a'],
        includeHub: true,
      }),
    ).toBe(false);
  });

  it('honours the conversation-scoped opt-out', () => {
    // The turn asked for hub-only retrieval; an allowed conversation must
    // still not be searched.
    expect(
      decideRetrievable([], [mail('conv_1')], {
        conversationIds: ['conv_1'],
        includeConversationScoped: false,
      }),
    ).toBe(false);
  });

  it('denies a trashed attachment even inside an allowed conversation', () => {
    expect(
      decideRetrievable(
        [],
        [unboundFile({ conversationId: 'conv_1', lifecycleStatus: 'trashed' })],
        { conversationIds: ['conv_1'] },
      ),
    ).toBe(false);
  });

  it('admits for the system caller, which is not a person', () => {
    // Ingest and purge run unscoped; `access === undefined` is that lane.
    expect(decideRetrievable([], [mail('conv_1')], undefined)).toBe(true);
  });

  it('never surfaces an attachment under a folder filter', () => {
    // A folder is a document concept; an emailed attachment is filed
    // nowhere, so a folder-scoped search must not reach it.
    expect(
      decideRetrievable(
        [],
        [mail('conv_1')],
        { conversationIds: ['conv_1'] },
        'Reports',
      ),
    ).toBe(false);
  });
});
