import { parsePlatformConfiguration } from './platform-model';

/** Synthetic settings span ordinary policies and external providers. No model
 * hardware, source checkout, organization or endpoint is shared by clients. */
export function platformConfigurationFixture() {
  const providers = ['reasoning', 'vision', 'embedding'].map((role) => ({
    kind: 'provider' as const,
    config: {
      name: `private-${role}`,
      displayName: `Example ${role}`,
      apiFormat: 'openai',
      baseUrl: `https://models.example.invalid/${role}/v1`,
      catalog: { source: 'models-endpoint' },
      embedding: role === 'embedding' ? 'supported' : 'unknown',
      auth: [{ method: 'env' }],
    },
    expectedModels: [
      {
        id: `Example-${role}`,
        provider: `private-${role}`,
        tags:
          role === 'embedding'
            ? ['embedding']
            : role === 'vision'
              ? ['chat', 'vision']
              : ['chat'],
        supportsTools: role === 'reasoning',
        supportsVision: role === 'vision',
        contextWindow: 131072,
      },
    ],
  }));
  return parsePlatformConfiguration({
    schemaVersion: 1,
    resources: [
      { kind: 'branding', config: { accentColor: '#336699' } },
      {
        kind: 'governance',
        key: 'session_idle_timeout',
        config: { enabled: true, idleTimeoutMinutes: 45 },
      },
      ...providers,
      ...providers.map((provider) => ({
        kind: 'provider-credential',
        config: {
          providerSlug: provider.config.name,
          authMethod: 'env',
          name: 'Managed external provider',
          envName: 'TALE_PROVIDER_KEY_EXAMPLE',
          modelAllowlist: provider.expectedModels.map((model) => model.id),
        },
      })),
      {
        kind: 'governance',
        key: 'vision_model',
        config: { providerSlug: 'private-vision', modelId: 'Example-vision' },
      },
      {
        kind: 'knowledge-embedding',
        config: {
          providerSlug: 'private-embedding',
          model: 'Example-embedding',
          dimensions: 1536,
          baseUrl: 'https://models.example.invalid/embedding/v1',
        },
      },
      {
        kind: 'deployment',
        config: { version: 1, sandboxRuntime: { tier: 'runc' } },
      },
    ],
  });
}
