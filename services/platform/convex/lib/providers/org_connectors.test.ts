import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadOrgCustomConnectors,
  resolveConnectorsForOrg,
  resolveProvidersDir,
} from './org_connectors';

const ORG = 'acme-corp';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'org-connectors-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function writeConnector(file: string, yaml: string): Promise<void> {
  const dir = path.join(root, ORG, 'providers');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, file), yaml, 'utf8');
}

const OLLAMA_YML = `
name: ollama-lab
displayName: Ollama Lab
apiFormat: openai
baseUrl: https://ollama.acme.internal/v1
catalog:
  source: models-endpoint
auth:
  - method: api-key
  - method: env
`;

describe('resolveProvidersDir', () => {
  it('resolves inside the org subtree and rejects invalid slugs', () => {
    expect(resolveProvidersDir(ORG)).toBe(path.join(root, ORG, 'providers'));
    expect(() => resolveProvidersDir('../escape')).toThrow('Invalid org slug');
  });
});

describe('loadOrgCustomConnectors', () => {
  it('returns empty for an org with no providers dir', () => {
    expect(loadOrgCustomConnectors(ORG)).toEqual([]);
  });

  it('loads a valid custom connector', async () => {
    await writeConnector('ollama-lab.yml', OLLAMA_YML);
    const connectors = loadOrgCustomConnectors(ORG);
    expect(connectors).toHaveLength(1);
    expect(connectors[0]).toMatchObject({
      name: 'ollama-lab',
      apiFormat: 'openai',
      baseUrl: 'https://ollama.acme.internal/v1',
      catalog: { source: 'models-endpoint' },
    });
  });

  it('ignores retired-format json files and secrets sidecars', async () => {
    await writeConnector('ollama-lab.yml', OLLAMA_YML);
    await writeConnector('openai.json', '{"apiKeyEnv":"OLD"}');
    await writeConnector('openai.secrets.json', '{"apiKey":"old"}');
    await writeConnector('ollama-lab.secrets.yml', 'apiKey: nope');
    const connectors = loadOrgCustomConnectors(ORG);
    expect(connectors.map((c) => c.name)).toEqual(['ollama-lab']);
  });

  it('skips a connector whose name does not match the file stem, loudly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeConnector(
      'misnamed.yml',
      OLLAMA_YML, // declares name: ollama-lab
    );
    expect(loadOrgCustomConnectors(ORG)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('must match the file name "misnamed"'),
    );
    error.mockRestore();
  });

  it('refuses to shadow a shipped connector', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeConnector(
      'openrouter.yml',
      OLLAMA_YML.replace('name: ollama-lab', 'name: openrouter'),
    );
    expect(loadOrgCustomConnectors(ORG)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('shadows a shipped connector'),
    );
    error.mockRestore();
  });

  it('skips an invalid file loudly and keeps the valid ones', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeConnector('ollama-lab.yml', OLLAMA_YML);
    await writeConnector('broken.yml', 'name: broken\nbaseUrl: not-a-url\n');
    const connectors = loadOrgCustomConnectors(ORG);
    expect(connectors.map((c) => c.name)).toEqual(['ollama-lab']);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('broken.yml'),
      expect.anything(),
    );
    error.mockRestore();
  });
});

describe('resolveConnectorsForOrg', () => {
  it('unions the shipped set with the org customs', async () => {
    await writeConnector('ollama-lab.yml', OLLAMA_YML);
    const names = resolveConnectorsForOrg(ORG).map((c) => c.name);
    expect(names).toContain('openrouter');
    expect(names).toContain('anthropic');
    expect(names).toContain('ollama-lab');
    // Uniqueness holds across the union (shadowing refused at load).
    expect(new Set(names).size).toBe(names.length);
  });
});
