import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadOrgCustomProviders,
  resolveProvidersForOrg,
  resolveProvidersDir,
} from './org_providers';

const ORG = 'acme-corp';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'org-providers-'));
  vi.stubEnv('TALE_CONFIG_DIR', root);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function writeProvider(file: string, yaml: string): Promise<void> {
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

describe('loadOrgCustomProviders', () => {
  it('returns empty for an org with no providers dir', () => {
    expect(loadOrgCustomProviders(ORG)).toEqual([]);
  });

  it('loads a valid custom provider', async () => {
    await writeProvider('ollama-lab.yml', OLLAMA_YML);
    const providers = loadOrgCustomProviders(ORG);
    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      name: 'ollama-lab',
      apiFormat: 'openai',
      baseUrl: 'https://ollama.acme.internal/v1',
      catalog: { source: 'models-endpoint' },
    });
  });

  it('ignores retired-format json files and secrets sidecars', async () => {
    await writeProvider('ollama-lab.yml', OLLAMA_YML);
    await writeProvider('openai.json', '{"apiKeyEnv":"OLD"}');
    await writeProvider('openai.secrets.json', '{"apiKey":"old"}');
    await writeProvider('ollama-lab.secrets.yml', 'apiKey: nope');
    const providers = loadOrgCustomProviders(ORG);
    expect(providers.map((c) => c.name)).toEqual(['ollama-lab']);
  });

  it('skips a provider whose name does not match the file stem, loudly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeProvider(
      'misnamed.yml',
      OLLAMA_YML, // declares name: ollama-lab
    );
    expect(loadOrgCustomProviders(ORG)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('must match the file name "misnamed"'),
    );
    error.mockRestore();
  });

  it('refuses to shadow a shipped provider', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeProvider(
      'openrouter.yml',
      OLLAMA_YML.replace('name: ollama-lab', 'name: openrouter'),
    );
    expect(loadOrgCustomProviders(ORG)).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('shadows a shipped provider'),
    );
    error.mockRestore();
  });

  it('skips an invalid file loudly and keeps the valid ones', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await writeProvider('ollama-lab.yml', OLLAMA_YML);
    await writeProvider('broken.yml', 'name: broken\nbaseUrl: not-a-url\n');
    const providers = loadOrgCustomProviders(ORG);
    expect(providers.map((c) => c.name)).toEqual(['ollama-lab']);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('broken.yml'),
      expect.anything(),
    );
    error.mockRestore();
  });
});

describe('resolveProvidersForOrg', () => {
  it('unions the shipped set with the org customs', async () => {
    await writeProvider('ollama-lab.yml', OLLAMA_YML);
    const names = resolveProvidersForOrg(ORG).map((c) => c.name);
    expect(names).toContain('openrouter');
    expect(names).toContain('anthropic');
    expect(names).toContain('ollama-lab');
    // Uniqueness holds across the union (shadowing refused at load).
    expect(new Set(names).size).toBe(names.length);
  });
});
