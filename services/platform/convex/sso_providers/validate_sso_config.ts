import { getAdapter } from './registry';

type ValidateSsoConfigArgs = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /**
   * Which provider type to validate against. Defaults to `entra-id` for
   * back-compat with callers that predate multi-provider support.
   */
  providerId?: string;
  scopes?: string[];
};

type ValidationResult = {
  valid: boolean;
  error?: string;
};

/**
 * Validate an SSO provider's configuration by dispatching to its adapter:
 * Entra runs a Microsoft Graph client-credentials probe, generic OIDC runs
 * `.well-known/openid-configuration` discovery. Centralising the dispatch here
 * keeps the save and test paths validating each provider type correctly.
 */
export async function validateSsoConfig(
  args: ValidateSsoConfigArgs,
): Promise<ValidationResult> {
  const providerId = args.providerId ?? 'entra-id';
  const adapter = getAdapter(providerId);
  if (!adapter) {
    return { valid: false, error: `Unsupported SSO provider: ${providerId}` };
  }
  return adapter.validateConfig({
    providerId,
    issuer: args.issuer,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    scopes: args.scopes ?? [],
  });
}
