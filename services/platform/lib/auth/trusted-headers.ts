import type { NextRequest } from 'next/server';

/**
 * Configuration for trusted headers authentication
 */
interface TrustedHeadersConfig {
  enabled: boolean;
  emailHeader: string;
  nameHeader: string;
  roleHeader: string;
  teamsHeader: string;
}

/**
 * Team entry from trusted headers
 */
export interface TrustedHeadersTeam {
  /** Team ID */
  id: string;
  /** Team name */
  name: string;
}

/**
 * User information extracted from trusted headers
 */
export interface TrustedHeadersUser {
  email: string;
  name: string;
  role: string;
  /** Teams from header. null = header not present, [] = header empty */
  teams: TrustedHeadersTeam[] | null;
}

/**
 * Get trusted headers configuration from environment variables
 */
function getTrustedHeadersConfig(): TrustedHeadersConfig {
  return {
    enabled: process.env.TRUSTED_HEADERS_ENABLED === 'true',
    emailHeader: process.env.TRUSTED_EMAIL_HEADER || 'X-Auth-Email',
    nameHeader: process.env.TRUSTED_NAME_HEADER || 'X-Auth-Name',
    roleHeader: process.env.TRUSTED_ROLE_HEADER || 'X-Auth-Role',
    teamsHeader: process.env.TRUSTED_TEAMS_HEADER || 'X-Auth-Teams',
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
  const teamsHeaderValue = request.headers.get(config.teamsHeader);

  // All required headers must be present (teams is optional)
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

  // Parse teams header:
  // - null: header not present -> don't modify teams
  // - []: header present but empty -> remove from all teams
  // - [{id, name}, ...]: parse comma-separated list in "id:name" format
  let teams: TrustedHeadersTeam[] | null = null;
  if (teamsHeaderValue !== null) {
    const parseResult = parseTeamsHeader(teamsHeaderValue);
    if (!parseResult.success) {
      console.warn('Invalid teams header format', { error: parseResult.error });
      return null;
    }
    teams = parseResult.teams;
  }

  return {
    email: email.toLowerCase().trim(),
    name: name.trim(),
    role: role.toLowerCase().trim(),
    teams,
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
 * Parse result from parseTeamsHeader
 */
export type ParseTeamsResult =
  | { success: true; teams: TrustedHeadersTeam[] }
  | { success: false; error: string };

/**
 * Parse comma-separated teams from header value.
 * Requires ID:Name format: "id1:Team A, id2:Team B"
 *
 * Each entry must contain both ID and name separated by colon.
 * Returns error if any entry is missing ID or name.
 * Returns empty array for empty/whitespace-only header.
 */
function parseTeamsHeader(headerValue: string): ParseTeamsResult {
  if (!headerValue || !headerValue.trim()) {
    return { success: true, teams: [] };
  }

  const teams: TrustedHeadersTeam[] = [];
  const entries = headerValue.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const colonIndex = entry.indexOf(':');
    if (colonIndex <= 0) {
      return {
        success: false,
        error: `Invalid team entry "${entry}": must be in "id:name" format`,
      };
    }

    const id = entry.substring(0, colonIndex).trim();
    const name = entry.substring(colonIndex + 1).trim();

    if (!id) {
      return {
        success: false,
        error: `Invalid team entry "${entry}": missing team ID`,
      };
    }

    if (!name) {
      return {
        success: false,
        error: `Invalid team entry "${entry}": missing team name`,
      };
    }

    teams.push({ id, name });
  }

  return { success: true, teams };
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

