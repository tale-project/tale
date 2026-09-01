// @vitest-environment node

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';

// The `*ForCaller` functions ARE the agent-file surface now — the Convex
// action wrappers that used to delegate to them retired with the runtime —
// so each is driven directly against a real temporary config tree.
// oxlint-disable-next-line typescript/no-explicit-any -- each returns its own view type; the tests assert on the values
type CallerFn = (args: unknown) => Promise<any>;

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-agent-actions-'));
  process.env.TALE_CONFIG_DIR = configRoot;
});

afterEach(async () => {
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
  await rm(configRoot, { recursive: true, force: true });
});

async function load(name: string): Promise<CallerFn> {
  const mod = (await import('./file_actions')) as unknown as Record<
    string,
    CallerFn
  >;
  return mod[name];
}

function agentYaml(fields: Record<string, string>): string {
  return `${Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}\n`;
}

async function seedAgent(
  orgSlug: string,
  slug: string,
  content: string,
): Promise<void> {
  const dir = path.join(configRoot, orgSlug, 'agents');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${slug}.yml`), content, 'utf-8');
}

const alice = { viewerUserId: 'user_alice', isOrgAdmin: false };
const bob = { viewerUserId: 'user_bob', isOrgAdmin: false };
const admin = { viewerUserId: 'user_admin', isOrgAdmin: true };

function errorCode(err: unknown): string | undefined {
  if (err instanceof AppError) {
    const data: unknown = err.data;
    if (typeof data === 'object' && data !== null && 'code' in data) {
      return String(data.code);
    }
  }
  return undefined;
}

const shared = agentYaml({
  name: 'assistant',
  'display-name': 'Assistant',
  description: 'General help',
  visibility: 'org',
  instructions: 'Be concise.',
});

const alicesDraft = agentYaml({
  name: 'draft',
  'display-name': 'Alice’s draft',
  visibility: 'private',
  owner: 'user_alice',
});

describe('listing agents', () => {
  it('shows shared agents to everyone and a private one only to its owner', async () => {
    await seedAgent('acme', 'assistant', shared);
    await seedAgent('acme', 'draft', alicesDraft);
    const listAgents = await load('listAgentsForCaller');

    const forAlice = await listAgents({
      orgSlug: 'acme',
      ...alice,
    });
    expect(forAlice.agents.map((a: { slug: string }) => a.slug)).toEqual([
      'assistant',
      'draft',
    ]);

    const forBob = await listAgents({ orgSlug: 'acme', ...bob });
    expect(forBob.agents.map((a: { slug: string }) => a.slug)).toEqual([
      'assistant',
    ]);
  });

  it('reports an unreadable file with a path relative to the org tree', async () => {
    await seedAgent('acme', 'broken', 'name: [unclosed');
    const listAgents = await load('listAgentsForCaller');

    const listing = await listAgents({
      orgSlug: 'acme',
      ...alice,
    });
    expect(listing.agents).toEqual([]);
    expect(listing.failures[0].path).toBe('agents/broken.yml');
    // The absolute server path never leaves the node layer.
    expect(listing.failures[0].path).not.toContain(configRoot);
  });

  it('says who may change what', async () => {
    await seedAgent('acme', 'assistant', shared);
    await seedAgent('acme', 'draft', alicesDraft);
    const listAgents = await load('listAgentsForCaller');

    const forAdmin = await listAgents({
      orgSlug: 'acme',
      ...admin,
    });
    expect(
      forAdmin.agents.map((a: { slug: string; canEdit: boolean }) => [
        a.slug,
        a.canEdit,
      ]),
    ).toEqual([['assistant', true]]);
  });
});

describe('reading one agent', () => {
  it('returns the persona in full', async () => {
    await seedAgent('acme', 'assistant', shared);
    const readAgent = await load('readAgentForCaller');

    const agent = await readAgent({
      orgSlug: 'acme',
      slug: 'assistant',
      ...bob,
    });
    expect(agent).toMatchObject({
      slug: 'assistant',
      displayName: 'Assistant',
      instructions: 'Be concise.',
      visibility: 'org',
      knowledge: 'all',
      canEdit: false,
    });
  });

  it('reads as absent for a member who may not use it', async () => {
    await seedAgent('acme', 'draft', alicesDraft);
    const readAgent = await load('readAgentForCaller');

    expect(
      await readAgent({
        orgSlug: 'acme',
        slug: 'draft',
        ...bob,
      }),
    ).toBeNull();
    expect(
      await readAgent({
        orgSlug: 'acme',
        slug: 'draft',
        ...alice,
      }),
    ).not.toBeNull();
  });

  it('names the file when it cannot be read', async () => {
    await seedAgent('acme', 'assistant', 'name: assistant\ncolour: blue\n');
    const readAgent = await load('readAgentForCaller');

    const err = await readAgent({
      orgSlug: 'acme',
      slug: 'assistant',
      ...alice,
    }).catch((e: unknown) => e);
    expect(errorCode(err)).toBe('AGENT_MALFORMED');
    expect((err as AppError<{ message: string }>).data.message).toContain(
      'agents/assistant.yml',
    );
  });

  it('refuses a slug that could escape the org tree', async () => {
    const readAgent = await load('readAgentForCaller');
    const err = await readAgent({
      orgSlug: 'acme',
      slug: '../../etc/passwd',
      ...alice,
    }).catch((e: unknown) => e);
    expect(errorCode(err)).toBe('INVALID_AGENT_SLUG');
  });
});

describe('resolving the agent answering a turn', () => {
  it('speaks the turn’s language and carries the bindings', async () => {
    await seedAgent(
      'acme',
      'assistant',
      [
        'name: assistant',
        'display-name: Assistant',
        'instructions: Be concise.',
        'knowledge: documents',
        'skills:',
        '  - pdf',
        'i18n:',
        '  de:',
        '    display-name: Assistent',
        '    instructions: Sei knapp.',
        '',
      ].join('\n'),
    );
    const resolveAgent = await load('resolveAgentForCaller');

    const resolved = await resolveAgent({
      orgSlug: 'acme',
      slug: 'assistant',
      locale: 'de-CH',
      ...bob,
    });
    expect(resolved).toEqual({
      slug: 'assistant',
      displayName: 'Assistent',
      description: undefined,
      instructions: 'Sei knapp.',
      tools: undefined,
      skills: ['pdf'],
      knowledge: 'documents',
    });
  });

  it('cannot borrow a persona its author kept private', async () => {
    await seedAgent('acme', 'draft', alicesDraft);
    const resolveAgent = await load('resolveAgentForCaller');

    expect(
      await resolveAgent({
        orgSlug: 'acme',
        slug: 'draft',
        locale: 'en',
        ...bob,
      }),
    ).toBeNull();
  });
});

describe('saving an agent', () => {
  it('starts as its author’s own and can be shared by an edit', async () => {
    const saveAgent = await load('saveAgentForCaller');

    const created = await saveAgent({
      orgSlug: 'acme',
      slug: 'writer',
      ...alice,
      displayName: 'Writer',
      instructions: 'Write plainly.',
    });
    expect(created).toMatchObject({
      slug: 'writer',
      visibility: 'private',
      owner: 'user_alice',
      knowledge: 'all',
      canEdit: true,
    });

    const shared_ = await saveAgent({
      orgSlug: 'acme',
      slug: 'writer',
      ...alice,
      displayName: 'Writer',
      visibility: 'org',
    });
    expect(shared_.visibility).toBe('org');
    // An edit that carries no instructions leaves them as they were.
    expect(shared_.instructions).toBe('Write plainly.');
  });

  it('keeps what the edit surface does not carry', async () => {
    await seedAgent(
      'acme',
      'assistant',
      [
        'name: assistant',
        'display-name: Assistant',
        'visibility: org',
        'i18n:',
        '  de:',
        '    display-name: Assistent',
        'metadata:',
        '  retired:',
        '    timeout-ms: 60000',
        '',
      ].join('\n'),
    );
    const saveAgent = await load('saveAgentForCaller');

    const saved = await saveAgent({
      orgSlug: 'acme',
      slug: 'assistant',
      ...admin,
      displayName: 'Assistant',
      instructions: 'Be brief.',
    });
    expect(saved.i18n).toEqual({ de: { displayName: 'Assistent' } });

    const readAgent = await load('readAgentForCaller');
    const reread = await readAgent({
      orgSlug: 'acme',
      slug: 'assistant',
      ...admin,
    });
    expect(reread.instructions).toBe('Be brief.');
  });

  it('narrows to nothing on an empty list and leaves an absent one alone', async () => {
    const saveAgent = await load('saveAgentForCaller');
    await saveAgent({
      orgSlug: 'acme',
      slug: 'writer',
      ...alice,
      displayName: 'Writer',
      tools: ['run_code'],
      skills: ['pdf'],
    });

    const narrowed = await saveAgent({
      orgSlug: 'acme',
      slug: 'writer',
      ...alice,
      displayName: 'Writer',
      tools: [],
    });
    expect(narrowed.tools).toEqual([]);
    expect(narrowed.skills).toEqual(['pdf']);
  });

  it('refuses to save over someone else’s private agent', async () => {
    await seedAgent('acme', 'draft', alicesDraft);
    const saveAgent = await load('saveAgentForCaller');

    const err = await saveAgent({
      orgSlug: 'acme',
      slug: 'draft',
      ...bob,
      displayName: 'Stolen',
    }).catch((e: unknown) => e);
    expect(errorCode(err)).toBe('AGENT_FORBIDDEN');
  });

  it('writes only into the organization it was told about', async () => {
    const saveAgent = await load('saveAgentForCaller');
    await saveAgent({
      orgSlug: 'acme',
      slug: 'writer',
      ...alice,
      displayName: 'Writer',
    });

    const listAgents = await load('listAgentsForCaller');
    const globex = await listAgents({
      orgSlug: 'globex',
      ...alice,
    });
    expect(globex.agents).toEqual([]);
    const acme = await listAgents({ orgSlug: 'acme', ...alice });
    expect(acme.agents.map((a: { slug: string }) => a.slug)).toEqual([
      'writer',
    ]);
  });
});

describe('deleting an agent', () => {
  it('deletes one the member owns, and reports a no-op otherwise', async () => {
    await seedAgent('acme', 'draft', alicesDraft);
    const deleteAgent = await load('deleteAgentForCaller');

    expect(
      await deleteAgent({
        orgSlug: 'acme',
        slug: 'draft',
        ...alice,
      }),
    ).toBe(true);
    expect(
      await deleteAgent({
        orgSlug: 'acme',
        slug: 'draft',
        ...alice,
      }),
    ).toBe(false);
  });

  it('refuses to delete someone else’s private agent', async () => {
    await seedAgent('acme', 'draft', alicesDraft);
    const deleteAgent = await load('deleteAgentForCaller');

    const err = await deleteAgent({
      orgSlug: 'acme',
      slug: 'draft',
      ...bob,
    }).catch((e: unknown) => e);
    expect(errorCode(err)).toBe('AGENT_FORBIDDEN');
  });

  it('lets an administrator remove a shared agent', async () => {
    await seedAgent('acme', 'assistant', shared);
    const deleteAgent = await load('deleteAgentForCaller');

    expect(
      await deleteAgent({
        orgSlug: 'acme',
        slug: 'assistant',
        ...admin,
      }),
    ).toBe(true);
  });

  it('cannot delete another organization’s agent — in both directions', async () => {
    await seedAgent('acme', 'assistant', shared);
    await seedAgent(
      'globex',
      'assistant',
      agentYaml({ name: 'assistant', 'display-name': 'Globex assistant' }),
    );
    const deleteAgent = await load('deleteAgentForCaller');
    const listAgents = await load('listAgentsForCaller');

    await deleteAgent({
      orgSlug: 'acme',
      slug: 'assistant',
      ...admin,
    });
    // The other org still has its own, and the reverse delete is equally
    // confined.
    expect(
      (await listAgents({ orgSlug: 'globex', ...admin })).agents.map(
        (a: { slug: string }) => a.slug,
      ),
    ).toEqual(['assistant']);

    await deleteAgent({
      orgSlug: 'globex',
      slug: 'assistant',
      ...admin,
    });
    expect((await listAgents({ orgSlug: 'globex', ...admin })).agents).toEqual(
      [],
    );
  });
});
