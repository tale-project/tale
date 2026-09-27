import { describe, expect, it } from 'vitest';

import {
  changelogEntry,
  contractChangesSection,
  listOperations,
} from './contract-notes.ts';

/** Two fingerprints, two openapi path sets and the changelog block they
 *  came with — the 1.20.0 → 1.21.0 bump the release notes never listed. */
const PREVIOUS_FINGERPRINT = {
  version: '1.20.0',
  operations: 'a1',
  schemas: 'b1',
};
const CURRENT_FINGERPRINT = {
  version: '1.21.0',
  operations: 'a2',
  schemas: 'b2',
};
const PREVIOUS_OPENAPI = {
  paths: {
    '/api/v1/me': { get: { operationId: 'me' } },
    '/api/v1/conversations': { get: {}, post: {} },
    '/api/v1/legacy': { delete: {} },
  },
};
const CURRENT_OPENAPI = {
  paths: {
    '/api/v1/me': { get: { operationId: 'me' } },
    '/api/v1/conversations': { get: {}, post: {} },
    '/api/v1/conversations/assignment': { post: {} },
  },
};
const CHANGELOG = `/**
 * The public REST contract version.
 *
 * 1.20.0 — 2026-09-21: \`PATCH /api/v1/projects/{id}/tasks/{taskId}\`
 * (\`setTaskArchived\`) — the task's lifecycle toggle.
 *
 * 1.21.0 — 2026-09-24: \`POST /api/v1/conversations/assignment\`
 * (\`assignConversationTeam\`) — queue a mirrored conversation to a team.
 * New code \`CONVERSATION_NOT_FOUND\` (404) for a mirror no snapshot created.
 *
 * 1.22.0 — 2026-09-27: \`startedVia\` on \`RunSummary\` and \`Run\`.
 */
export const API_CONTRACT_VERSION = '1.22.0';
`;

const snapshot = (
  fingerprint: { version: string },
  openapi: { paths: Record<string, Record<string, unknown>> },
) => ({ version: fingerprint.version, operations: listOperations(openapi) });

describe('listOperations', () => {
  it('lists every METHOD path the document publishes, sorted', () => {
    expect(listOperations(CURRENT_OPENAPI)).toEqual([
      'GET /api/v1/conversations',
      'GET /api/v1/me',
      'POST /api/v1/conversations',
      'POST /api/v1/conversations/assignment',
    ]);
  });
});

describe('changelogEntry', () => {
  it('returns the paragraph of the named version and nothing of its neighbours', () => {
    const entry = changelogEntry(CHANGELOG, '1.21.0');
    expect(entry).toContain('1.21.0 — 2026-09-24');
    expect(entry).toContain('CONVERSATION_NOT_FOUND');
    expect(entry).not.toContain('setTaskArchived');
    expect(entry).not.toContain('startedVia');
    expect(entry).not.toContain('*');
  });

  it('is empty for a version without an entry', () => {
    expect(changelogEntry(CHANGELOG, '9.9.9')).toBe('');
  });
});

describe('contractChangesSection', () => {
  it('lists the version move, the operations added and removed, and the changelog entry', () => {
    const section = contractChangesSection({
      previous: snapshot(PREVIOUS_FINGERPRINT, PREVIOUS_OPENAPI),
      previousTag: 'v0.5.53',
      current: snapshot(CURRENT_FINGERPRINT, CURRENT_OPENAPI),
      changelog: CHANGELOG,
    });
    expect(section).toMatch(/^## API contract changes\n/);
    expect(section).toContain(
      'The contract moved from 1.20.0 to 1.21.0 (4 → 4 operations).',
    );
    expect(section).toContain(
      'Added operations:\n- `POST /api/v1/conversations/assignment`\n',
    );
    expect(section).toContain(
      'Removed operations:\n- `DELETE /api/v1/legacy`\n',
    );
    expect(section).toContain('### Changelog\n\n1.21.0 — 2026-09-24');
    expect(section).not.toContain('startedVia');
  });

  it('says so when the version did not move', () => {
    const section = contractChangesSection({
      previous: snapshot(CURRENT_FINGERPRINT, CURRENT_OPENAPI),
      previousTag: 'v0.5.55',
      current: snapshot(CURRENT_FINGERPRINT, CURRENT_OPENAPI),
      changelog: CHANGELOG,
    });
    expect(section).toBe(
      '## API contract changes\n\nNone in this range. The contract stays at 1.21.0: 4 operations.\n',
    );
  });

  it('names a missing changelog entry instead of inventing one', () => {
    const section = contractChangesSection({
      previous: snapshot(PREVIOUS_FINGERPRINT, PREVIOUS_OPENAPI),
      previousTag: 'v0.5.53',
      current: snapshot({ version: '1.30.0' }, CURRENT_OPENAPI),
      changelog: CHANGELOG,
    });
    expect(section).toContain('Added operations:');
    expect(section).toContain(
      '1.30.0 carries no changelog entry in `api-contract.ts`.',
    );
  });

  it('refuses to compare when the previous tag recorded no fingerprint', () => {
    const section = contractChangesSection({
      previous: null,
      previousTag: 'v0.5.21',
      current: snapshot(CURRENT_FINGERPRINT, CURRENT_OPENAPI),
      changelog: CHANGELOG,
    });
    expect(section).toContain(
      'No contract fingerprint was recorded at v0.5.21',
    );
    expect(section).toContain('The contract is at 1.21.0: 4 operations.');
  });
});
