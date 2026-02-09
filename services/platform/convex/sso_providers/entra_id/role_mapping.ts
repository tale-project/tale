import type { PlatformRole, RoleMappingRule, SsoUserInfo } from '../types';

const MAX_PATTERN_LENGTH = 100;
const MAX_WILDCARDS = 3;

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return false;
  }
  const wildcardCount = (pattern.match(/\*/g) || []).length;
  if (wildcardCount > MAX_WILDCARDS) {
    return false;
  }

  const normalizedValue = value.toLowerCase().trim();
  const normalizedPattern = pattern.toLowerCase().trim();

  const regexPattern = normalizedPattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  const regex = new RegExp(`^${regexPattern}$`, 'u');
  return regex.test(normalizedValue);
}

export function mapEntraRoleToPlatformRole(
  rules: RoleMappingRule[],
  defaultRole: PlatformRole,
  userInfo: SsoUserInfo,
): PlatformRole {
  for (const rule of rules) {
    if (rule.source === 'jobTitle' && userInfo.jobTitle) {
      if (matchesPattern(userInfo.jobTitle, rule.pattern)) {
        return rule.targetRole;
      }
    } else if (rule.source === 'appRole' && userInfo.appRoles) {
      for (const appRole of userInfo.appRoles) {
        if (matchesPattern(appRole, rule.pattern)) {
          return rule.targetRole;
        }
      }
    } else if (rule.source === 'group' && userInfo.groups) {
      for (const group of userInfo.groups) {
        if (matchesPattern(group, rule.pattern)) {
          return rule.targetRole;
        }
      }
    }
  }

  return defaultRole;
}
