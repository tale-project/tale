import type { SsoUserInfo } from '../../lib/shared/schemas/sso_providers';

/**
 * Match Entra ID user attributes against a scope value.
 *
 * Scope values use the format `attributeName:expectedValue`, e.g.:
 * - `department:Finance`
 * - `location:Berlin`
 * - `companyName:Acme Corp`
 * - `country:DE`
 * - `city:Munich`
 * - `customAttribute:someValue`
 *
 * Used by budget enforcement, feature flags, and default model resolution
 * to scope policies to specific user segments based on Entra ID attributes.
 */
export function matchEntraAttribute(
  userAttributes: SsoUserInfo,
  scopeValue: string,
): boolean {
  const colonIndex = scopeValue.indexOf(':');
  if (colonIndex === -1) return false;

  const attributeName = scopeValue.slice(0, colonIndex).trim();
  const expectedValue = scopeValue
    .slice(colonIndex + 1)
    .trim()
    .toLowerCase();

  switch (attributeName) {
    case 'department':
      return userAttributes.department?.toLowerCase() === expectedValue;
    case 'location':
      return userAttributes.location?.toLowerCase() === expectedValue;
    case 'companyName':
      return userAttributes.companyName?.toLowerCase() === expectedValue;
    case 'country':
      return userAttributes.country?.toLowerCase() === expectedValue;
    case 'city':
      return userAttributes.city?.toLowerCase() === expectedValue;
    case 'jobTitle':
      return userAttributes.jobTitle?.toLowerCase() === expectedValue;
    case 'customAttribute': {
      if (!userAttributes.customAttributes) return false;
      return Object.values(userAttributes.customAttributes).some(
        (v) => v.toLowerCase() === expectedValue,
      );
    }
    default:
      return false;
  }
}

/**
 * Check if a user matches any of the given scope values.
 * Returns true if at least one scope matches.
 */
export function matchesAnyEntraScope(
  userAttributes: SsoUserInfo,
  scopeValues: string[],
): boolean {
  return scopeValues.some((scope) =>
    matchEntraAttribute(userAttributes, scope),
  );
}
