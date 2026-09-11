import { modelSettingsSchema } from './model-settings';

/** Synthetic external catalogs; no server, model weights or hardware is used. */
export function modelSettingsFixture() {
  return modelSettingsSchema.parse({
    schemaVersion: 1,
    exclusiveProviders: true,
    providers: ['reasoning', 'vision', 'embedding'].map((role) => ({
      definition: {
        name: `private-${role}`,
        displayName: `Example ${role}`,
        apiFormat: 'openai',
        baseUrl: `https://models.example.invalid/${role}/v1`,
        catalog: { source: 'models-endpoint' },
        embedding: role === 'embedding' ? 'supported' : 'unknown',
        auth: [{ method: 'env' }],
      },
      credential: {
        name: 'Managed external provider',
        envName: 'TALE_PROVIDER_KEY_EXAMPLE',
      },
      models: [
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
    })),
    vision: { providerSlug: 'private-vision', modelId: 'Example-vision' },
    embedding: {
      providerSlug: 'private-embedding',
      model: 'Example-embedding',
      dimensions: 1536,
      baseUrl: 'https://models.example.invalid/embedding/v1',
    },
  });
}
