import type { PlatformRole, RoleMappingRule, SsoUserInfo } from '../types';

function matchesPattern(value: string, pattern: string): boolean {
	const normalizedValue = value.toLowerCase().trim();
	const normalizedPattern = pattern.toLowerCase().trim();

	const regexPattern = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');

	const regex = new RegExp(`^${regexPattern}$`);
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
