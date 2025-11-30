/**
 * Create secrets API for integration sandbox
 */

export interface SecretsApi {
  get: (key: string) => string | undefined;
}

export function createSecretsApi(secrets: Record<string, string>): SecretsApi {
  return {
    get: (key: string) => secrets[key],
  };
}
