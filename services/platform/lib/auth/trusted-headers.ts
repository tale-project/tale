import type { NextRequest } from 'next/server';

/**
 * Configuration for trusted headers authentication
 */
export interface TrustedHeadersConfig {
  enabled: boolean;
  emailHeader: string;
  nameHeader: string;
  roleHeader: string;
}

/**
 * User information extracted from trusted headers
 */
export interface TrustedHeadersUser {
  email: string;
  name: string;
  role: string;
}

/**
 * Get trusted headers configuration from environment variables
 */
export function getTrustedHeadersConfig(): TrustedHeadersConfig {
  return {
    enabled: process.env.TRUSTED_HEADERS_ENABLED === 'true',
    emailHeader: process.env.TRUSTED_EMAIL_HEADER || 'X-Auth-Email',
    nameHeader: process.env.TRUSTED_NAME_HEADER || 'X-Auth-Name',
    roleHeader: process.env.TRUSTED_ROLE_HEADER || 'X-Auth-Role',
  };
}

/**
 * Check if trusted headers authentication is enabled
 */
export function isTrustedHeadersEnabled(): boolean {
  return process.env.TRUSTED_HEADERS_ENABLED === 'true';
}

/**
 * Extract user information from trusted headers
 * Returns null if any required header is missing
 */
export function extractTrustedHeaders(
  request: NextRequest,
): TrustedHeadersUser | null {
  const config = getTrustedHeadersConfig();

  if (!config.enabled) {
    return null;
  }

  const email = request.headers.get(config.emailHeader);
  const name = request.headers.get(config.nameHeader);
  const role = request.headers.get(config.roleHeader);

  // All headers must be present
  if (!email || !name || !role) {
    console.warn('Trusted headers authentication enabled but headers missing', {
      hasEmail: !!email,
      hasName: !!name,
      hasRole: !!role,
      emailHeader: config.emailHeader,
      nameHeader: config.nameHeader,
      roleHeader: config.roleHeader,
    });
    return null;
  }

  // Validate email format
  if (!isValidEmail(email)) {
    console.warn('Invalid email in trusted header', { email });
    return null;
  }

  // Validate role
  if (!isValidRole(role)) {
    console.warn('Invalid role in trusted header', { role });
    return null;
  }

  return {
    email: email.toLowerCase().trim(),
    name: name.trim(),
    role: role.toLowerCase().trim(),
  };
}

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate role against supported roles
 */
function isValidRole(role: string): boolean {
  const validRoles = ['admin', 'developer', 'editor', 'member'];
  return validRoles.includes(role.toLowerCase());
}

/**
 * Map trusted header role to organization role
 * This handles any role name variations from different auth providers
 */
export function mapRoleToOrgRole(role: string): string {
  const normalizedRole = role.toLowerCase().trim();

  // Direct mapping for standard roles
  const roleMap: Record<string, string> = {
    admin: 'admin',
    administrator: 'admin',
    developer: 'developer',
    dev: 'developer',
    editor: 'editor',
    edit: 'editor',
    member: 'member',
    user: 'member',
  };

  return roleMap[normalizedRole] || 'member'; // Default to member if unknown
}

