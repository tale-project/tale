// @vitest-environment node

/**
 * Who may edit which projects, the one rule a run's starter and a
 * dispatch's authority over the boards it serves are judged by.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findActingMember, getActingAudience } from '../../auth/membership.ts';
import { memberEditableProjects } from './edit-right.ts';

vi.mock('../../auth/membership.ts', () => ({
  findActingMember: vi.fn(),
  getActingAudience: vi.fn(),
}));

/** Development and Billing are shared with the whole organization. */
const sql = Object.assign(
  (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const ids = (values.find(Array.isArray) ?? []) as string[];
    return Promise.resolve(ids.map((id) => ({ id, teamIds: [] })));
  },
  { unsafe: (text: string) => text },
) as unknown as Sql;

const editor = {
  id: 'm-1',
  organizationId: 'org-1',
  userId: 'key-dev',
  role: 'editor',
};

afterEach(() => {
  vi.resetAllMocks();
});

describe('a project’s own API key edits that project alone [TASK-R79]', () => {
  it('edits every project its role and audience reach, as a person does', async () => {
    vi.mocked(findActingMember).mockResolvedValue(
      editor as Awaited<ReturnType<typeof findActingMember>>,
    );
    vi.mocked(getActingAudience).mockResolvedValue({ teamIds: [] });
    expect(
      await memberEditableProjects(sql, {
        organizationId: 'org-1',
        userId: 'ada',
        projectIds: ['p-dev', 'p-billing'],
      }),
    ).toEqual(new Set(['p-dev', 'p-billing']));
  });

  it('keeps Development’s own key to Development, though Billing is open to its role', async () => {
    vi.mocked(findActingMember).mockResolvedValue(
      editor as Awaited<ReturnType<typeof findActingMember>>,
    );
    vi.mocked(getActingAudience).mockResolvedValue({
      teamIds: [],
      projectScope: 'p-dev',
    });
    expect(
      await memberEditableProjects(sql, {
        organizationId: 'org-1',
        userId: 'key-dev',
        projectIds: ['p-dev', 'p-billing'],
      }),
    ).toEqual(new Set(['p-dev']));
  });
});
