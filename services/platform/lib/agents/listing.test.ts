import { describe, expect, it } from 'vitest';

import type { AgentDefinition } from '../shared/schemas/agents';
import {
  canEditAgent,
  listOrgAgents,
  readOrgAgent,
  readOrgAgents,
  type AgentFileReader,
} from './listing';
import { serializeAgentYaml } from './parse';

/** A whole fleet of organizations, as files. Nothing here knows about an
 *  org until a reader is built for one. */
type Fleet = Record<string, Record<string, string>>;

function agent(
  name: string,
  overrides: Partial<AgentDefinition> = {},
): AgentDefinition {
  return {
    name,
    displayName: name,
    visibility: 'org',
    knowledge: 'all',
    ...overrides,
  };
}

function fileFor(definition: AgentDefinition): string {
  return serializeAgentYaml(definition);
}

/** A reader bound to ONE org, exactly as the filesystem one is. */
function readerFor(fleet: Fleet, orgSlug: string): AgentFileReader {
  return {
    listSlugs: () => Promise.resolve(Object.keys(fleet[orgSlug] ?? {})),
    readAgentFile: (slug) => Promise.resolve(fleet[orgSlug]?.[slug] ?? null),
    describe: (slug) => `/config/${orgSlug}/agents/${slug}.yml`,
  };
}

// Agents only know `private | org`, so every viewer carries no teams.
const alice = {
  kind: 'user' as const,
  userId: 'user_alice',
  teamIds: [],
  isOrgAdmin: false,
};
const bob = {
  kind: 'user' as const,
  userId: 'user_bob',
  teamIds: [],
  isOrgAdmin: false,
};
const admin = {
  kind: 'user' as const,
  userId: 'user_admin',
  teamIds: [],
  isOrgAdmin: true,
};

describe('listing an organization’s agents', () => {
  const fleet: Fleet = {
    acme: {
      assistant: fileFor(agent('assistant', { displayName: 'Assistant' })),
      researcher: fileFor(agent('researcher')),
    },
  };

  it('reads every agent, sorted, with its path', async () => {
    const listing = await readOrgAgents(readerFor(fleet, 'acme'));
    expect(listing.agents.map((a) => a.slug)).toEqual([
      'assistant',
      'researcher',
    ]);
    expect(listing.agents[0].path).toBe('/config/acme/agents/assistant.yml');
    expect(listing.failures).toEqual([]);
  });

  it('reads one named agent, and `null` for one the org does not have', async () => {
    const reader = readerFor(fleet, 'acme');
    expect(
      (await readOrgAgent(reader, 'assistant'))?.definition.displayName,
    ).toBe('Assistant');
    expect(await readOrgAgent(reader, 'nobody')).toBeNull();
  });

  it('keeps one broken file from taking the roster down', async () => {
    const listing = await readOrgAgents(
      readerFor({ acme: { ...fleet.acme, broken: 'name: [unclosed' } }, 'acme'),
    );
    expect(listing.agents.map((a) => a.slug)).toEqual([
      'assistant',
      'researcher',
    ]);
    expect(listing.failures).toHaveLength(1);
    expect(listing.failures[0]).toMatchObject({
      slug: 'broken',
      path: '/config/acme/agents/broken.yml',
    });
  });

  it('refuses a file whose name disagrees with its slug', async () => {
    const listing = await readOrgAgents(
      readerFor({ acme: { renamed: fileFor(agent('assistant')) } }, 'acme'),
    );
    expect(listing.agents).toEqual([]);
    expect(listing.failures[0].message).toContain(
      'does not match the file name',
    );
  });

  it('refuses a slug no file could carry', async () => {
    await expect(
      readOrgAgent(readerFor({ acme: {} }, 'acme'), '../escape'),
    ).rejects.toThrow('not a valid agent slug');
  });
});

describe('who sees which agents', () => {
  const fleet: Fleet = {
    acme: {
      assistant: fileFor(agent('assistant')),
      'alices-draft': fileFor(
        agent('alices-draft', { visibility: 'private', owner: 'user_alice' }),
      ),
      'bobs-draft': fileFor(
        agent('bobs-draft', { visibility: 'private', owner: 'user_bob' }),
      ),
    },
  };

  it('shows shared agents to everyone and a private one only to its owner', async () => {
    const forAlice = await listOrgAgents(readerFor(fleet, 'acme'), alice);
    expect(forAlice.agents.map((a) => a.slug)).toEqual([
      'alices-draft',
      'assistant',
    ]);

    const forBob = await listOrgAgents(readerFor(fleet, 'acme'), bob);
    expect(forBob.agents.map((a) => a.slug)).toEqual([
      'assistant',
      'bobs-draft',
    ]);
  });

  it('reports a broken file to everyone — it is an operator problem', async () => {
    const listing = await listOrgAgents(
      readerFor({ acme: { ...fleet.acme, broken: '{[' } }, 'acme'),
      bob,
    );
    expect(listing.failures.map((f) => f.slug)).toEqual(['broken']);
  });

  it('lets an administrator curate a shared agent, but not someone’s own', () => {
    const shared = agent('assistant');
    const private_ = agent('alices-draft', {
      visibility: 'private',
      owner: 'user_alice',
    });
    expect(canEditAgent(shared, admin)).toBe(true);
    expect(canEditAgent(private_, admin)).toBe(false);
    expect(canEditAgent(private_, alice)).toBe(true);
  });
});

describe('one organization’s agents are invisible to another', () => {
  // Two orgs, each with an agent the other must never see — asserted in BOTH
  // directions, because a leak has a direction and testing one proves nothing
  // about the other.
  const fleet: Fleet = {
    acme: { 'acme-only': fileFor(agent('acme-only')) },
    globex: { 'globex-only': fileFor(agent('globex-only')) },
  };

  it('lists only the org the reader was built for', async () => {
    const acme = await listOrgAgents(readerFor(fleet, 'acme'), alice);
    expect(acme.agents.map((a) => a.slug)).toEqual(['acme-only']);

    const globex = await listOrgAgents(readerFor(fleet, 'globex'), alice);
    expect(globex.agents.map((a) => a.slug)).toEqual(['globex-only']);
  });

  it('cannot reach the other org’s agent even by name', async () => {
    // The same member, the same slug, a different reader: the answer is
    // "there is no such agent" in both directions.
    expect(
      await readOrgAgent(readerFor(fleet, 'acme'), 'globex-only'),
    ).toBeNull();
    expect(
      await readOrgAgent(readerFor(fleet, 'globex'), 'acme-only'),
    ).toBeNull();
  });
});
