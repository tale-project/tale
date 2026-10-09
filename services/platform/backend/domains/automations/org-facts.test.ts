// @vitest-environment node

/**
 * What the validator learns of the organization (`readOrgFacts`): each fact
 * read the way the run that uses it resolves it, only for this
 * organization, only what the document names — secret names only for a
 * caller who may list them, the skills of only the installations the caller
 * can read — and a read that fails is "cannot tell", never a failed
 * validation.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgFactsQuery } from '../../../lib/engine/core/slots.ts';

const mocks = vi.hoisted(() => ({
  bindingProjectIds: vi.fn(),
  listTriggers: vi.fn(),
  listAgentSecrets: vi.fn(),
  listConnectedConnectorSlugs: vi.fn(),
  listProjectSkillSlugs: vi.fn(),
  listSkillsForViewer: vi.fn(),
  resolveOrgSlug: vi.fn(),
  loadConnectorDefinitions: vi.fn(),
}));

vi.mock('./store.ts', () => ({
  bindingProjectIds: mocks.bindingProjectIds,
  listTriggers: mocks.listTriggers,
}));
vi.mock('../agent_secrets/service.ts', () => ({
  listAgentSecrets: mocks.listAgentSecrets,
}));
vi.mock('../connector_credentials/service.ts', () => ({
  listConnectedConnectorSlugs: mocks.listConnectedConnectorSlugs,
}));
vi.mock('../chat/composer.ts', () => ({
  listProjectSkillSlugs: mocks.listProjectSkillSlugs,
}));
vi.mock('../../core/skills/file_actions.ts', () => ({
  listSkillsForViewer: mocks.listSkillsForViewer,
}));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: mocks.resolveOrgSlug,
}));
vi.mock('../../../lib/connectors/catalog.ts', () => ({
  loadConnectorDefinitions: mocks.loadConnectorDefinitions,
}));

import { readOrgFacts } from './org-facts.ts';

const sql = {} as unknown as Sql;
const SENTINEL = 'SENTINEL-agent-secret-value-0x5eed';

const ALL: OrgFactsQuery = {
  automation: 'support/reply',
  skills: true,
  connectors: true,
  secrets: true,
  harnesses: true,
  event: true,
};

const NONE: OrgFactsQuery = {
  skills: false,
  connectors: false,
  secrets: false,
  harnesses: false,
  event: false,
};

const admin = async () => ({ role: 'admin', readable: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveOrgSlug.mockResolvedValue('acme');
  mocks.bindingProjectIds.mockResolvedValue(['proj_hr', 'proj_sales']);
  mocks.listSkillsForViewer.mockResolvedValue({
    skills: [{ slug: 'reply-style' }],
    failures: [],
  });
  mocks.listProjectSkillSlugs.mockImplementation(
    async (_sql: unknown, args: { projectId: string }) =>
      args.projectId === 'proj_hr' ? ['hr-policy'] : ['sales-deck'],
  );
  mocks.loadConnectorDefinitions.mockReturnValue([
    { name: 'github', auth: [{ method: 'bearer' }] },
    { name: 'gmail', auth: [{ method: 'oauth2' }] },
    { name: 'task', auth: [{ method: 'platform' }] },
  ]);
  mocks.listConnectedConnectorSlugs.mockResolvedValue(['github']);
  mocks.listAgentSecrets.mockResolvedValue([
    {
      name: 'SUPPORT_SIGNATURE',
      description: null,
      maskedPreview: 'SENT••••eed',
      createdAt: 1,
      updatedAt: 1,
      updatedBy: 'u',
    },
  ]);
  mocks.listTriggers.mockResolvedValue([
    { kind: 'event', enabled: true, event: 'task.create' },
  ]);
});

describe('readOrgFacts', () => {
  it('reads every fact in the caller’s organization only [MCP-R15]', async () => {
    const facts = await readOrgFacts(sql, 'org_acme', ALL, admin);
    expect(facts.skills).toEqual(
      new Set(['reply-style', 'hr-policy', 'sales-deck']),
    );
    expect(facts.connectors).toEqual({
      catalogued: new Set(['github', 'gmail', 'task']),
      connected: new Set(['github']),
      needsCredential: new Set(['github', 'gmail']),
    });
    expect(facts.secrets).toEqual(new Set(['SUPPORT_SIGNATURE']));
    expect(facts.harnesses?.has('claude-code')).toBe(true);
    // A harness the managed lane cannot run is not one a step may name.
    expect(facts.harnesses?.has('cursor')).toBe(false);
    expect(facts.boundEvent).toEqual({
      event: 'task.create',
      raised: expect.arrayContaining(['task.created']),
    });
    // Tenant isolation: every read names this organization, and the skill
    // reads go through its own slug.
    expect(mocks.resolveOrgSlug).toHaveBeenCalledWith(sql, 'org_acme');
    expect(mocks.bindingProjectIds).toHaveBeenCalledWith(
      sql,
      'org_acme',
      'support/reply',
    );
    for (const call of mocks.listProjectSkillSlugs.mock.calls) {
      expect(call[1]).toMatchObject({ organizationId: 'org_acme' });
    }
    expect(mocks.listSkillsForViewer).toHaveBeenCalledWith({
      orgSlug: 'acme',
      viewer: { kind: 'org' },
    });
    expect(mocks.listConnectedConnectorSlugs).toHaveBeenCalledWith(
      sql,
      'org_acme',
    );
    expect(mocks.listAgentSecrets).toHaveBeenCalledWith(sql, 'org_acme');
    expect(mocks.listTriggers).toHaveBeenCalledWith(
      sql,
      'org_acme',
      'support/reply',
    );
    // Names only: no value — not even the masked preview — is a fact.
    expect(JSON.stringify([...(facts.secrets ?? [])])).not.toContain('SENT');
    expect(JSON.stringify(facts)).not.toContain(SENTINEL);
  });

  it('reads nothing the document does not name', async () => {
    expect(await readOrgFacts(sql, 'org_acme', NONE, admin)).toEqual({});
    for (const read of Object.values(mocks)) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('tells a member’s validation no secret name, so it cannot probe for one', async () => {
    const facts = await readOrgFacts(sql, 'org_acme', ALL, async () => ({
      role: 'member',
      readable: new Set(['proj_sales']),
    }));
    expect(facts.secrets).toBeUndefined();
    expect(mocks.listAgentSecrets).not.toHaveBeenCalled();
    // Team skills come only from installations the member can read.
    expect(facts.skills).toEqual(new Set(['reply-style', 'sales-deck']));
  });

  it('reads the organization’s skills alone for a document no automation names yet', async () => {
    const facts = await readOrgFacts(
      sql,
      'org_acme',
      { ...ALL, automation: undefined, event: false },
      admin,
    );
    expect(facts.skills).toEqual(new Set(['reply-style']));
    expect(mocks.bindingProjectIds).not.toHaveBeenCalled();
    expect(facts).not.toHaveProperty('boundEvent');
  });

  it('answers no bound event when the trigger is not an enabled event trigger', async () => {
    mocks.listTriggers.mockResolvedValue([
      { kind: 'event', enabled: false, event: 'task.create' },
    ]);
    expect(
      (await readOrgFacts(sql, 'org_acme', ALL, admin)).boundEvent,
    ).toBeNull();
  });

  it('leaves a fact out when its read fails, and keeps the others', async () => {
    mocks.listConnectedConnectorSlugs.mockRejectedValue(
      new Error('connection reset'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const facts = await readOrgFacts(sql, 'org_acme', ALL, admin);
    expect(facts).not.toHaveProperty('connectors');
    expect(facts.skills?.has('reply-style')).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      '[automations] the connectors could not be read for validation; cannot tell:',
      'connection reset',
    );
    warn.mockRestore();
  });

  it('cannot tell the skills of an organization whose slug is gone', async () => {
    mocks.resolveOrgSlug.mockResolvedValue(null);
    const facts = await readOrgFacts(sql, 'org_acme', ALL, admin);
    expect(facts).not.toHaveProperty('skills');
  });
});
