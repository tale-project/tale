type EntraErrorInfo = {
  messageKey: string;
  recoveryKey: string;
  requiresStepUp: boolean;
};

const ENTRA_ERROR_MAP: Record<string, EntraErrorInfo> = {
  AADSTS50076: {
    messageKey: 'sso.errors.mfaRequired',
    recoveryKey: 'sso.errors.recovery.completeMfa',
    requiresStepUp: true,
  },
  AADSTS53003: {
    messageKey: 'sso.errors.conditionalAccessBlocked',
    recoveryKey: 'sso.errors.recovery.contactAdmin',
    requiresStepUp: false,
  },
  AADSTS50105: {
    messageKey: 'sso.errors.userNotAssigned',
    recoveryKey: 'sso.errors.recovery.contactAdmin',
    requiresStepUp: false,
  },
  AADSTS50058: {
    messageKey: 'sso.errors.silentAuthFailed',
    recoveryKey: 'sso.errors.recovery.signInInteractively',
    requiresStepUp: false,
  },
  AADSTS700082: {
    messageKey: 'sso.errors.refreshTokenExpired',
    recoveryKey: 'sso.errors.recovery.signInAgain',
    requiresStepUp: false,
  },
  AADSTS65001: {
    messageKey: 'sso.errors.consentRequired',
    recoveryKey: 'sso.errors.recovery.grantConsent',
    requiresStepUp: false,
  },
  AADSTS50079: {
    messageKey: 'sso.errors.mfaRequired',
    recoveryKey: 'sso.errors.recovery.completeMfa',
    requiresStepUp: true,
  },
};

const SILENT_AUTH_ERROR_CODES = new Set([
  'interaction_required',
  'login_required',
  'consent_required',
]);

export function parseEntraErrorCode(
  errorDescription: string,
): string | undefined {
  const match = errorDescription.match(/AADSTS\d+/);
  return match?.[0];
}

export function getEntraErrorInfo(
  errorCode: string,
): EntraErrorInfo | undefined {
  return ENTRA_ERROR_MAP[errorCode];
}

export function isSilentAuthError(error: string): boolean {
  return SILENT_AUTH_ERROR_CODES.has(error);
}

export function extractClaimsChallenge(
  errorDescription: string,
): string | undefined {
  const claimsMatch = errorDescription.match(/"claims"\s*:\s*"([^"]+)"/);
  if (claimsMatch?.[1]) {
    return claimsMatch[1];
  }

  const jsonMatch = errorDescription.match(/claims=([^&\s]+)/);
  if (jsonMatch?.[1]) {
    try {
      return decodeURIComponent(jsonMatch[1]);
    } catch {
      return undefined;
    }
  }

  return undefined;
}
