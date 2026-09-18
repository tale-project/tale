// 7 days

export interface TrustedTeamEntry {
  id: string;
  name: string;
}

/**
 * Parse the teams header value into structured entries.
 * Accepted formats, comma-separated: "Name One, Name Two" (the plain group
 * list most authenticating proxies emit) or "id1:Name One, id2:Name Two".
 * Teams are matched and created by NAME; a bare entry is its own id.
 * Exported for the 0.5 runtime's twin route.
 */
export function parseTeamsHeader(value: string): TrustedTeamEntry[] | null {
  if (!value.trim()) return null;

  const entries: TrustedTeamEntry[] = [];
  for (const segment of value.split(',')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) {
      entries.push({ id: trimmed, name: trimmed });
      continue;
    }
    const id = trimmed.slice(0, colonIndex).trim();
    const name = trimmed.slice(colonIndex + 1).trim();
    if (id && name) {
      entries.push({ id, name });
    }
  }

  return entries.length > 0 ? entries : null;
}
