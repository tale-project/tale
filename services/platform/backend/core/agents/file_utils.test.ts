// @vitest-environment node

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readOrgAgent, readOrgAgents } from '../../../lib/agents/listing';
import {
  createOrgAgentReader,
  listAgentSlugs,
  readAgentFileText,
  relativeAgentPath,
  removeAgentFile,
  resolveAgentFilePath,
  resolveAgentHistoryDir,
  resolveAgentsDir,
  writeAgentFileText,
} from './file_utils';

let configRoot: string;
let savedConfigDir: string | undefined;

beforeEach(async () => {
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  configRoot = await mkdtemp(path.join(tmpdir(), 'tale-agents-'));
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

const assistant = agentYaml({
  name: 'assistant',
  'display-name': 'Assistant',
});

describe('path resolution', () => {
  it('puts every org’s agents under its own config subtree', () => {
    expect(resolveAgentsDir('acme')).toBe(
      path.join(configRoot, 'acme', 'agents'),
    );
    expect(resolveAgentFilePath('acme', 'assistant')).toBe(
      path.join(configRoot, 'acme', 'agents', 'assistant.yml'),
    );
    expect(resolveAgentHistoryDir('acme', 'assistant')).toBe(
      path.join(configRoot, 'acme', 'agents', '.history', 'assistant'),
    );
    expect(relativeAgentPath('assistant')).toBe('agents/assistant.yml');
  });

  it('refuses an org slug or an agent slug that could escape the tree', () => {
    expect(() => resolveAgentsDir('../etc')).toThrow('Invalid org slug');
    expect(() => resolveAgentFilePath('acme', '../secrets')).toThrow(
      'Invalid agent slug',
    );
    expect(() => resolveAgentHistoryDir('acme', 'a/b')).toThrow(
      'Invalid agent slug',
    );
  });
});

describe('listing what is on disk', () => {
  it('is an empty roster when the org has no agents directory', async () => {
    expect(await listAgentSlugs('acme')).toEqual([]);
  });

  it('lists agent files and nothing else', async () => {
    await seedAgent('acme', 'assistant', assistant);
    await seedAgent('acme', 'researcher', agentYaml({ name: 'researcher' }));
    const dir = path.join(configRoot, 'acme', 'agents');
    // Not agents: the history trail, an editor leftover, a name no slug can
    // carry, and a file left in the shape this domain converted away from.
    await mkdir(path.join(dir, '.history'), { recursive: true });
    await writeFile(path.join(dir, 'notes.txt'), 'hello', 'utf-8');
    await writeFile(path.join(dir, 'Assistant Copy.yml'), assistant, 'utf-8');
    await writeFile(path.join(dir, 'old.json'), '{}', 'utf-8');

    expect((await listAgentSlugs('acme')).sort()).toEqual([
      'assistant',
      'researcher',
    ]);
  });
});

describe('reading a file', () => {
  it('returns null for an agent the org does not have', async () => {
    expect(await readAgentFileText('acme', 'assistant')).toBeNull();
  });

  it('refuses to follow a symlinked agent file', async () => {
    const secret = path.join(configRoot, 'secret.yml');
    await writeFile(secret, assistant, 'utf-8');
    await mkdir(path.join(configRoot, 'acme', 'agents'), { recursive: true });
    await symlink(
      secret,
      path.join(configRoot, 'acme', 'agents', 'assistant.yml'),
    );

    await expect(readAgentFileText('acme', 'assistant')).rejects.toThrow(
      /symlink/i,
    );
  });
});

describe('writing an agent', () => {
  it('creates the file, then keeps the superseded version in the trail', async () => {
    await writeAgentFileText('acme', 'assistant', assistant);
    expect(await readAgentFileText('acme', 'assistant')).toBe(assistant);
    // Nothing to supersede yet, so no history is written for a first write.
    await expect(
      readdir(resolveAgentHistoryDir('acme', 'assistant')),
    ).rejects.toThrow();

    const edited = agentYaml({
      name: 'assistant',
      'display-name': 'Assistant (edited)',
    });
    await writeAgentFileText('acme', 'assistant', edited);

    expect(await readAgentFileText('acme', 'assistant')).toBe(edited);
    const history = await readdir(resolveAgentHistoryDir('acme', 'assistant'));
    expect(history).toHaveLength(1);
    expect(
      await readFile(
        path.join(resolveAgentHistoryDir('acme', 'assistant'), history[0]),
        'utf-8',
      ),
    ).toBe(assistant);
  });

  it('removes an agent with its trail, and reports a no-op delete', async () => {
    await writeAgentFileText('acme', 'assistant', assistant);
    await writeAgentFileText('acme', 'assistant', agentYaml({ name: 'x' }));

    expect(await removeAgentFile('acme', 'assistant')).toBe(true);
    expect(await readAgentFileText('acme', 'assistant')).toBeNull();
    await expect(
      readdir(resolveAgentHistoryDir('acme', 'assistant')),
    ).rejects.toThrow();
    expect(await removeAgentFile('acme', 'assistant')).toBe(false);
  });
});

describe('a reader is bound to one organization', () => {
  beforeEach(async () => {
    await seedAgent(
      'acme',
      'acme-only',
      agentYaml({ name: 'acme-only', 'display-name': 'Acme only' }),
    );
    await seedAgent(
      'globex',
      'globex-only',
      agentYaml({ name: 'globex-only', 'display-name': 'Globex only' }),
    );
  });

  it('sees only its own org’s agents — in both directions', async () => {
    const acme = await readOrgAgents(createOrgAgentReader('acme'));
    expect(acme.agents.map((a) => a.slug)).toEqual(['acme-only']);

    const globex = await readOrgAgents(createOrgAgentReader('globex'));
    expect(globex.agents.map((a) => a.slug)).toEqual(['globex-only']);
  });

  it('cannot reach the other org’s agent by name — in both directions', async () => {
    expect(
      await readOrgAgent(createOrgAgentReader('acme'), 'globex-only'),
    ).toBeNull();
    expect(
      await readOrgAgent(createOrgAgentReader('globex'), 'acme-only'),
    ).toBeNull();
  });

  it('writes into its own tree only', async () => {
    await writeAgentFileText('acme', 'assistant', assistant);
    expect(await listAgentSlugs('globex')).toEqual(['globex-only']);
    expect(
      (await readdir(path.join(configRoot, 'acme', 'agents'))).sort(),
    ).toEqual(['acme-only.yml', 'assistant.yml']);
  });
});
