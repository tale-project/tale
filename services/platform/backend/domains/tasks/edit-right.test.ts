// @vitest-environment node

/**
 * Who may edit which projects, the one rule a run's starter and a
 * dispatch's authority over the boards it serves are judged by.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findActingMember, getActingAudience } from '../../auth/membership.ts';
import {
  memberEditableProjects,
  memberReadableProjects,
} from './edit-right.ts';

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

describe('a person reads the projects of their audience their role may not edit [TASK-R82]', () => {
  it('reads what a member’s audience reaches, though they edit none of it', async () => {
    vi.mocked(findActingMember).mockResolvedValue({
      ...editor,
      userId: 'bea',
      role: 'member',
    } as Awaited<ReturnType<typeof findActingMember>>);
    vi.mocked(getActingAudience).mockResolvedValue({ teamIds: [] });
    const args = {
      organizationId: 'org-1',
      userId: 'bea',
      projectIds: ['p-dev', 'p-billing'],
    };
    expect(await memberEditableProjects(sql, args)).toEqual(new Set());
    expect(await memberReadableProjects(sql, args)).toEqual(
      new Set(['p-dev', 'p-billing']),
    );
  });

  it('reads nothing for someone who left, or a disabled member', async () => {
    vi.mocked(findActingMember).mockResolvedValueOnce(null);
    const args = {
      organizationId: 'org-1',
      userId: 'bea',
      projectIds: ['p-dev'],
    };
    expect(await memberReadableProjects(sql, args)).toEqual(new Set());
    vi.mocked(findActingMember).mockResolvedValueOnce({
      ...editor,
      role: 'disabled',
    } as Awaited<ReturnType<typeof findActingMember>>);
    expect(await memberReadableProjects(sql, args)).toEqual(new Set());
  });
});
