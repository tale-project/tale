import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parse, stringify } from 'yaml';

import { externalDepError } from '../../utils/fail';
import type { ProvisionContext } from './identity';
import { modelSettingsFixture } from './model-settings-fixture';
import { configureNativeModelSettings } from './model-settings-native';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const describePosix = describe.skipIf(process.platform === 'win32');
const secret = 'synthetic-model-settings-key-that-must-remain-private';
type Credential = {
  id: string;
  providerSlug: string;
  authMethod: string;
  name: string;
  envName: string | null;
  endpointUrl: string | null;
  modelAllowlist: string[] | null;
  isDefault: boolean;
  status: 'active' | 'disabled';
};

/** Actual loopback HTTP and native YAML readers; native DB writes are modeled
 * explicitly in memory. No live provider, key, model or organization is used. */
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'tale-model-settings-native-')),
  );
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const configRoot = join(root, 'config');
  const stateDirectory = join(root, 'state');
  const spec = modelSettingsFixture();
  const orgDirectory = join(configRoot, 'synthetic-client');
  await mkdir(orgDirectory, { recursive: true, mode: 0o700 });
  await mkdir(stateDirectory, { mode: 0o700 });
  const visionFile = join(orgDirectory, 'governance/vision-model.yml');
  const embeddingFile = join(orgDirectory, 'knowledge/embedding.json');
  const events: string[] = [];
  const state = {
    credentials: [] as Credential[],
    vision: null as unknown,
    embedding: null as unknown,
    documents: [] as unknown[],
    lost: '',
    drift: '',
    catalog: 'exact',
    finalRead: false,
  };
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      events.push(`${request.method} ${url.pathname}`);
      if (url.pathname.startsWith('/catalog/')) {
        expect(request.headers.get('authorization')).toBeNull();
        const key = url.pathname.slice('/catalog/'.length);
        const provider = spec.providers.find(
          (entry) => entry.definition.name === `private-${key}`,
        )!;
        if (state.catalog === 'unavailable')
          return new Response(secret, { status: 503 });
        return Response.json(
          state.catalog === 'exact'
            ? {
                data: provider.models.map((model) => ({
                  id: model.id,
                  context_window: model.contextWindow,
                  modalities: {
                    input: model.supportsVision ? ['text', 'image'] : ['text'],
                    output: model.tags.includes('embedding')
                      ? ['embeddings']
                      : ['text'],
                  },
                  supported_parameters: model.supportsTools
                    ? ['tools', 'tool_choice']
                    : [],
                })),
              }
            : { data: [] },
        );
      }
      expect(url.searchParams.get('orgId')).toBe('synthetic-org');
      expect(request.headers.get('cookie')).toBe('session=synthetic');
      if (request.method === 'POST') {
        const intent = JSON.parse(
          await readFile(join(stateDirectory, 'model-settings.json'), 'utf8'),
        );
        expect(intent.phase).toBe('pending');
        const body = await request.json();
        if (url.pathname === '/api/app/provider-credentials/') {
          expect(JSON.stringify(body)).not.toContain(secret);
          const typed = body as Omit<
            Credential,
            'id' | 'endpointUrl' | 'isDefault' | 'status'
          >;
          state.credentials.push({
            ...typed,
            id: `credential-${state.credentials.length + 1}`,
            endpointUrl: null,
            isDefault: true,
            status: 'active',
          });
        } else if (
          url.pathname === '/api/app/governance/policies/vision_model'
        ) {
          state.vision = (body as { config: unknown }).config;
          await mkdir(join(orgDirectory, 'governance'), { mode: 0o700 });
          await writeFile(visionFile, stringify(state.vision));
        } else if (url.pathname === '/api/app/knowledge/embedding') {
          state.embedding = body;
          await mkdir(join(orgDirectory, 'knowledge'), { mode: 0o700 });
          await writeFile(embeddingFile, JSON.stringify(body));
          state.finalRead = true;
          if (state.drift === 'file')
            await writeFile(
              join(orgDirectory, 'providers/private-reasoning.yml'),
              'name: corrupt\n',
            );
          if (state.drift === 'credentials') state.credentials = [];
        } else return new Response(null, { status: 404 });
        if (state.lost === url.pathname) {
          state.lost = '';
          return new Response(secret, { status: 502 });
        }
        return Response.json({ ok: true, requeued: 0 });
      }
      if (url.pathname === '/api/app/provider-credentials/')
        return Response.json({ credentials: state.credentials });
      if (url.pathname === '/api/app/governance/policies/vision_model')
        return Response.json({
          policy:
            state.vision === null || (state.drift === 'api' && state.finalRead)
              ? null
              : { key: 'vision_model', config: state.vision },
        });
      if (url.pathname === '/api/app/knowledge/embedding')
        return Response.json(
          state.embedding === null
            ? { configured: false }
            : { configured: true, ...(state.embedding as object) },
        );
      if (url.pathname === '/api/app/documents/paginated')
        return Response.json({ page: state.documents, isDone: true });
      return new Response(null, { status: 404 });
    },
  });
  cleanups.push(async () => {
    await server.stop(true);
  });
  const headers = () =>
    new Headers({
      cookie: 'session=synthetic',
      origin: 'https://native.example.invalid',
    });
  const context: ProvisionContext = {
    origin: 'https://native.example.invalid',
    baseUrl: server.url.origin,
    organization: { id: 'synthetic-org', slug: 'synthetic-client' },
    user: { id: 'synthetic-user' },
    headers,
    request: (path, method = 'GET', body) =>
      fetch(new URL(path, server.url), {
        method,
        headers: headers(),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    async requireJson(response) {
      if (!response.ok) {
        await response.body?.cancel();
        throw externalDepError('Synthetic native request failed.');
      }
      return response.json();
    },
  };
  const catalogFetch = (input: string, options: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('https://models.example.invalid');
    expect(options?.redirect).toBe('error');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const provider = spec.providers.find(
      (entry) => `${entry.definition.baseUrl}/models` === url.href,
    );
    expect(provider).toBeDefined();
    return fetch(
      new URL(
        `/catalog/${provider!.definition.name.slice('private-'.length)}`,
        server.url,
      ),
      options,
    );
  };
  const options = {
    deploymentBundleSha256: 'b'.repeat(64),
    organizationSlug: 'synthetic-client',
    stateDirectory,
    configRoot,
    catalogFetch,
    environment: {
      TALE_PROVIDER_KEY_EXAMPLE: secret,
    },
  };
  const run = () => configureNativeModelSettings(spec, context, options);
  return {
    root,
    configRoot,
    stateDirectory,
    orgDirectory,
    visionFile,
    embeddingFile,
    spec,
    context,
    options,
    events,
    state,
    run,
  };
}

describePosix(
  'native external model settings provisioning with synthetic HTTP',
  () => {
    test('creates exact declared providers, then proves a mutation-free replay without hosted discovery', async () => {
      const f = await fixture();
      const result = await f.run();
      expect(result.configured).toBe(true);
      expect(result.unchanged).toBe(false);
      expect(result.embedding?.dimensions).toBe(1536);
      expect(result.vision?.providerSlug).toBe('private-vision');
      expect(f.state.credentials).toHaveLength(3);
      expect(f.events.filter((event) => event.startsWith('POST'))).toHaveLength(
        5,
      );
      expect(
        f.events.some((event) => event.includes('/providers/catalogs')),
      ).toBe(false);
      expect(
        (await lstat(join(f.stateDirectory, 'model-settings.json'))).mode &
          0o077,
      ).toBe(0);
      for (const file of await readdir(join(f.orgDirectory, 'providers'))) {
        const provider = parse(
          await readFile(join(f.orgDirectory, 'providers', file), 'utf8'),
        );
        expect(provider.catalog.source).toBe('models-endpoint');
        expect(provider.baseUrl).toStartWith('https://models.example.invalid/');
      }
      f.events.length = 0;
      expect((await f.run()).unchanged).toBe(true);
      expect(f.events.filter((event) => event.startsWith('POST'))).toEqual([]);
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(
        await readFile(join(f.stateDirectory, 'model-settings.json'), 'utf8'),
      ).not.toContain(secret);
    });

    test.each([
      'credential',
      'policy',
      'embedding',
      'corpus',
      'state-link',
      'config-link',
    ] as const)(
      'refuses existing %s conflict before provider or API writes',
      async (kind) => {
        const f = await fixture();
        if (kind === 'credential')
          f.state.credentials.push({
            id: 'hosted',
            providerSlug: 'remote',
            name: 'foreign',
            authMethod: 'env',
            envName: 'TALE_PROVIDER_KEY_OTHER',
            endpointUrl: null,
            modelAllowlist: null,
            isDefault: true,
            status: 'active',
          });
        if (kind === 'policy') {
          await mkdir(join(f.orgDirectory, 'governance'));
          await writeFile(
            f.visionFile,
            'providerSlug: remote\nmodelId: foreign\n',
          );
          f.state.vision = { providerSlug: 'remote', modelId: 'foreign' };
        }
        if (kind === 'embedding') {
          await mkdir(join(f.orgDirectory, 'knowledge'));
          f.state.embedding = {
            providerSlug: 'remote',
            model: 'foreign',
            dimensions: 4096,
          };
          await writeFile(f.embeddingFile, JSON.stringify(f.state.embedding));
        }
        if (kind === 'corpus')
          f.state.documents.push({ id: 'existing-document' });
        if (kind === 'state-link' || kind === 'config-link') {
          const link = join(f.root, 'link');
          await symlink(
            kind === 'state-link' ? f.stateDirectory : f.configRoot,
            link,
          );
          if (kind === 'state-link') f.options.stateDirectory = link;
          else f.options.configRoot = link;
        }
        await expect(f.run()).rejects.toThrow();
        expect(f.events.filter((event) => event.startsWith('POST'))).toEqual(
          [],
        );
        expect(existsSync(join(f.orgDirectory, 'providers'))).toBe(false);
        expect(existsSync(join(f.stateDirectory, 'model-settings.json'))).toBe(
          false,
        );
      },
    );

    test.each([
      '/api/app/provider-credentials/',
      '/api/app/governance/policies/vision_model',
      '/api/app/knowledge/embedding',
    ])(
      'reconciles an accepted write whose response was lost at %s',
      async (path) => {
        const f = await fixture();
        f.state.lost = path;
        await expect(f.run()).rejects.toThrow('request failed');
        expect(
          JSON.parse(
            await readFile(
              join(f.stateDirectory, 'model-settings.json'),
              'utf8',
            ),
          ).phase,
        ).toBe('pending');
        await f.run();
        expect(f.state.credentials).toHaveLength(3);
        expect(
          f.events.filter((event) => event.startsWith('POST')),
        ).toHaveLength(5);
      },
    );

    test.each(['file', 'credentials', 'api'])(
      'refuses final %s drift instead of recording ready',
      async (drift) => {
        const f = await fixture();
        f.state.drift = drift;
        await expect(f.run()).rejects.toThrow();
        expect(
          JSON.parse(
            await readFile(
              join(f.stateDirectory, 'model-settings.json'),
              'utf8',
            ),
          ).phase,
        ).toBe('pending');
      },
    );

    test.each(['credential', 'provider', 'vision', 'embedding'] as const)(
      'holds missing %s after ready instead of silently recreating it',
      async (kind) => {
        const f = await fixture();
        await f.run();
        const receipt = await readFile(
          join(f.stateDirectory, 'model-settings.json'),
          'utf8',
        );
        if (kind === 'credential') f.state.credentials = [];
        if (kind === 'provider')
          await rm(join(f.orgDirectory, 'providers/private-reasoning.yml'));
        if (kind === 'vision') {
          await rm(f.visionFile);
          f.state.vision = null;
        }
        if (kind === 'embedding') {
          await rm(f.embeddingFile);
          f.state.embedding = null;
        }
        f.events.length = 0;
        await expect(f.run()).rejects.toThrow();
        expect(f.events.filter((event) => event.startsWith('POST'))).toEqual(
          [],
        );
        expect(
          await readFile(join(f.stateDirectory, 'model-settings.json'), 'utf8'),
        ).toBe(receipt);
      },
    );

    test('retains a ready receipt across unchanged settings in a new deployment bundle and rollback; pending cannot change bundle', async () => {
      const f = await fixture();
      await f.run();
      const prior = await readFile(
        join(f.stateDirectory, 'model-settings.json'),
        'utf8',
      );
      f.options.deploymentBundleSha256 = 'c'.repeat(64);
      f.events.length = 0;
      expect((await f.run()).unchanged).toBe(false);
      expect(f.events.filter((event) => event.startsWith('POST'))).toEqual([]);
      const retained = await readdir(
        join(f.stateDirectory, 'model-settings-history'),
      );
      expect(retained).toHaveLength(1);
      expect(
        await readFile(
          join(f.stateDirectory, 'model-settings-history', retained[0]!),
          'utf8',
        ),
      ).toBe(prior);
      f.options.deploymentBundleSha256 = 'b'.repeat(64);
      await f.run();
      const receipt = JSON.parse(
        await readFile(join(f.stateDirectory, 'model-settings.json'), 'utf8'),
      );
      await writeFile(
        join(f.stateDirectory, 'model-settings.json'),
        JSON.stringify({ ...receipt, phase: 'pending' }),
      );
      f.options.deploymentBundleSha256 = 'f'.repeat(64);
      f.events.length = 0;
      await expect(f.run()).rejects.toThrow('receipt');
      expect(f.events).toEqual([]);
    });

    test.each(['unavailable', 'mismatch'])(
      'refuses %s catalogs before any write and never forwards credentials',
      async (catalog) => {
        const f = await fixture();
        f.state.catalog = catalog;
        await expect(f.run()).rejects.toThrow('catalog');
        expect(f.events.filter((event) => event.startsWith('POST'))).toEqual(
          [],
        );
        expect(existsSync(join(f.orgDirectory, 'providers'))).toBe(false);
        expect(existsSync(join(f.stateDirectory, 'model-settings.json'))).toBe(
          false,
        );
      },
    );

    test.each([
      'tenant',
      'operator',
      'missing-key',
      'key-control',
      'metadata-host',
    ])('holds %s identity or boundary drift without a write', async (kind) => {
      const f = await fixture();
      if (kind === 'tenant') f.context.organization.slug = 'foreign';
      if (kind === 'missing-key')
        f.options.environment.TALE_PROVIDER_KEY_EXAMPLE = '';
      if (kind === 'key-control')
        f.options.environment.TALE_PROVIDER_KEY_EXAMPLE += '\n';
      if (kind === 'metadata-host')
        f.spec.providers[0]!.definition.baseUrl = 'http://169.254.169.254/v1';
      if (kind === 'operator') {
        await f.run();
        f.context.user.id = 'foreign';
        f.events.length = 0;
      }
      await expect(f.run()).rejects.toThrow();
      expect(f.events).toEqual([]);
    });

    test('refuses writable state and malformed metadata without leaking untrusted error values', async () => {
      const f = await fixture();
      await chmod(f.stateDirectory, 0o777);
      await expect(f.run()).rejects.toThrow();
      expect(f.events).toEqual([]);
      await chmod(f.stateDirectory, 0o700);
      f.context.requireJson = async () => ({
        credentials: [{ status: secret }],
      });
      try {
        await f.run();
        throw new Error('unexpected success');
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
      expect(existsSync(join(f.orgDirectory, 'providers'))).toBe(false);
    });
  },
);
