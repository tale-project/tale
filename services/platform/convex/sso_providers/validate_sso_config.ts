type ValidateSsoConfigArgs = {
  issuer: string;
  clientId: string;
  clientSecret: string;
};

type ValidationResult = {
  valid: boolean;
  error?: string;
  tokenEndpoint?: string;
};

export async function validateSsoConfig(args: ValidateSsoConfigArgs): Promise<ValidationResult> {
  const { issuer, clientId, clientSecret } = args;

  // Step 1: Validate issuer by fetching OpenID Discovery document
  const discoveryUrl = issuer.endsWith('/')
    ? `${issuer}.well-known/openid-configuration`
    : `${issuer}/.well-known/openid-configuration`;

  let tokenEndpoint: string;

  try {
    const discoveryResponse = await fetch(discoveryUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!discoveryResponse.ok) {
      return {
        valid: false,
        error: `Invalid Issuer URL: Could not fetch OpenID configuration (HTTP ${discoveryResponse.status})`,
      };
    }

    const discoveryDoc = await discoveryResponse.json();

    if (!discoveryDoc.token_endpoint) {
      return {
        valid: false,
        error: 'Invalid Issuer URL: OpenID configuration missing token_endpoint',
      };
    }

    if (!discoveryDoc.authorization_endpoint) {
      return {
        valid: false,
        error: 'Invalid Issuer URL: OpenID configuration missing authorization_endpoint',
      };
    }

    tokenEndpoint = discoveryDoc.token_endpoint;
  } catch (error) {
    return {
      valid: false,
      error: `Invalid Issuer URL: ${error instanceof Error ? error.message : 'Network error'}`,
    };
  }

  // Step 2: Validate Client ID and Client Secret using client credentials flow
  try {
    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.json().catch(() => ({}));
      const errorDescription =
        errorBody.error_description || errorBody.error || `HTTP ${tokenResponse.status}`;

      if (errorDescription.includes('AADSTS700016')) {
        return {
          valid: false,
          error: 'Invalid Client ID: Application not found in the directory',
        };
      }

      if (errorDescription.includes('AADSTS7000215')) {
        return {
          valid: false,
          error: 'Invalid Client Secret: The provided secret is incorrect or expired',
        };
      }

      if (errorDescription.includes('AADSTS700024')) {
        return {
          valid: false,
          error: 'Client Secret expired: Please generate a new secret in Azure portal',
        };
      }

      return {
        valid: false,
        error: `Authentication failed: ${errorDescription}`,
      };
    }

    // Successfully obtained a token - credentials are valid
    return {
      valid: true,
      tokenEndpoint,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Failed to validate credentials: ${error instanceof Error ? error.message : 'Network error'}`,
    };
  }
}
