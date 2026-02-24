/**
 * Shared status priority for selecting the "best" version per workflow/agent name.
 * Higher number = higher priority: active > draft > archived.
 */
export const STATUS_PRIORITY: Record<string, number> = {
  active: 3,
  draft: 2,
  archived: 1,
};
