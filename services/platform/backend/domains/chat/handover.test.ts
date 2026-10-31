// @vitest-environment node

/**
 * The chat hand-over note's facts (`readTaskHandoverFacts`) count the
 * person's projects where they live (`readProjectAgentCoverage`, which joins
 * the readable projects) and take back only the names the note shows
 * (#5193). They used to read the person's whole project list and count it
 * here.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HANDOVER_PROJECTS_NAMED } from '../../../lib/chat/handover.ts';
import { findOrganizationMember } from '../../auth/membership.ts';
import {
  getProjectAuthContext,
  readProjectAgentCoverage,
} from '../projects/service.ts';
import { readStandardAgentAvailability } from '../projects/standard-agent.ts';
import { mentionAutomationEnabled } from '../tasks/run-start.ts';
import { readTaskHandoverFacts } from './handover.ts';

vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(),
}));
vi.mock('../projects/service.ts', () => ({
  getProjectAuthContext: vi.fn(),
  readProjectAgentCoverage: vi.fn(),
}));
vi.mock('../projects/standard-agent.ts', () => ({
  readStandardAgentAvailability: vi.fn(),
}));
vi.mock('../tasks/run-start.ts', () => ({
  mentionAutomationEnabled: vi.fn(),
}));

// The reader hands the connection on and never queries it itself.
const sql = {} as Sql;
const ARGS = { organizationId: 'org-a', userId: 'user-1' };

function seat(role: string) {
  vi.mocked(findOrganizationMember).mockResolvedValue({
    id: 'member-1',
    organizationId: 'org-a',
    userId: 'user-1',
    role,
  });
  vi.mocked(getProjectAuthContext).mockResolvedValue({
    organizationId: 'org-a',
    userId: 'user-1',
    role,
    teamIds: ['team-finance'],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(mentionAutomationEnabled).mockResolvedValue(true);
  vi.mocked(readStandardAgentAvailability).mockResolvedValue({
    enabled: false,
    available: false,
  });
});

describe('readTaskHandoverFacts', () => {
  it('takes the names the note shows and counts the rest where they live', async () => {
    seat('editor');
    vi.mocked(readProjectAgentCoverage).mockResolvedValue({
      named: ['A', 'B', 'C', 'D', 'E'],
      withAgents: 8,
      withoutAgents: 2,
    });

    expect(await readTaskHandoverFacts(sql, ARGS)).toEqual({
      projectsWithAgents: ['A', 'B', 'C', 'D', 'E'],
      moreProjectsWithAgents: 3,
      projectsWithoutAgents: 2,
      canAddAgents: true,
      automationEnabled: true,
      standardAgent: false,
    });
    expect(readProjectAgentCoverage).toHaveBeenCalledWith(
      sql,
      expect.objectContaining({ organizationId: 'org-a', role: 'editor' }),
      HANDOVER_PROJECTS_NAMED,
    );
  });

  it('lets an editor add agents where a project lacks one [PROJ-R3]', async () => {
    seat('developer');
    vi.mocked(readProjectAgentCoverage).mockResolvedValue({
      named: [],
      withAgents: 0,
      withoutAgents: 1,
    });

    expect((await readTaskHandoverFacts(sql, ARGS)).canAddAgents).toBe(true);
  });

  it('leaves adding agents to others for a member, who only reads [PROJ-R3]', async () => {
    seat('member');
    vi.mocked(readProjectAgentCoverage).mockResolvedValue({
      named: ['Website relaunch'],
      withAgents: 1,
      withoutAgents: 3,
    });

    const facts = await readTaskHandoverFacts(sql, ARGS);
    expect(facts.canAddAgents).toBe(false);
    expect(facts.moreProjectsWithAgents).toBe(0);
  });

  it('has nothing to add agents to when every project has one', async () => {
    seat('admin');
    vi.mocked(readProjectAgentCoverage).mockResolvedValue({
      named: ['Website relaunch'],
      withAgents: 1,
      withoutAgents: 0,
    });

    expect((await readTaskHandoverFacts(sql, ARGS)).canAddAgents).toBe(false);
  });

  it('reads no project for a disabled seat or a stranger [PROJ-R2]', async () => {
    const empty = {
      projectsWithAgents: [],
      moreProjectsWithAgents: 0,
      projectsWithoutAgents: 0,
      canAddAgents: false,
      automationEnabled: false,
      standardAgent: false,
    };
    seat('disabled');
    expect(await readTaskHandoverFacts(sql, ARGS)).toEqual(empty);
    vi.mocked(findOrganizationMember).mockResolvedValue(null);
    expect(await readTaskHandoverFacts(sql, ARGS)).toEqual(empty);
    expect(readProjectAgentCoverage).not.toHaveBeenCalled();
  });
});
