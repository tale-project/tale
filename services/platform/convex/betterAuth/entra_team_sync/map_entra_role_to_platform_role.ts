export type PlatformRole = 'admin' | 'developer' | 'editor' | 'member' | 'disabled';

export type RoleMappingRule = {
  source: 'jobTitle' | 'appRole';
  pattern: string;
  targetRole: PlatformRole;
};

/**
 * Check if a value matches a glob-like pattern.
 * Supports * as wildcard (matches any characters).
 * Case-insensitive matching.
 */
function matchesPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.toLowerCase().trim();
  const normalizedPattern = pattern.toLowerCase().trim();

  // Convert glob pattern to regex
  // Escape special regex chars except *, then convert * to .*
  const regexPattern = normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(normalizedValue);
}

/**
 * Map Entra ID roles/job titles to platform roles using custom rules.
 *
 * @param rules - Custom mapping rules (first match wins)
 * @param defaultRole - Role to use if no rules match
 * @param jobTitle - User's job title from Entra ID profile
 * @param appRoles - App Role assignments from Entra ID
 */
export function mapEntraRoleToPlatformRole(
  rules: RoleMappingRule[],
  defaultRole: PlatformRole,
  jobTitle?: string,
  appRoles?: string[],
): PlatformRole {
  // Process rules in order (first match wins)
  for (const rule of rules) {
    if (rule.source === 'jobTitle' && jobTitle) {
      if (matchesPattern(jobTitle, rule.pattern)) {
        return rule.targetRole;
      }
    } else if (rule.source === 'appRole' && appRoles) {
      for (const appRole of appRoles) {
        if (matchesPattern(appRole, rule.pattern)) {
          return rule.targetRole;
        }
      }
    }
  }

  return defaultRole;
}
