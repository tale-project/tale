// Shared MCP-server "Name" (slug) rules. Imported by both the client form
// (services/platform/app/features/settings/mcp-servers) and the server-side
// create/update actions so validation can't drift between the two.

export const MCP_SERVER_NAME_MAX_LENGTH = 64;

// Lowercase alphanumeric, hyphen-separated. A single character is valid; a
// leading/trailing hyphen, uppercase letter, or any other symbol is not.
export const MCP_SERVER_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Validate an MCP-server name. Returns `null` when valid, otherwise a stable
 * machine code describing the first violation. Callers map the code to a
 * localized (client) or human-readable (server) message.
 */
export function validateMcpServerName(
  name: string,
): 'required' | 'too_long' | 'invalid_format' | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > MCP_SERVER_NAME_MAX_LENGTH) return 'too_long';
  if (!MCP_SERVER_NAME_RE.test(trimmed)) return 'invalid_format';
  return null;
}
