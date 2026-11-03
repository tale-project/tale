import { z } from 'zod';

import '@/lib/zod-config';

/** The running sessions that already exit through an IP, and the IP itself. */
export interface SharedIpConflict {
  exitIp: string | null;
  names: string[];
}

const conflictSchema = z.object({
  exitIp: z.string().nullish(),
  sessions: z.array(z.object({ name: z.string() })).nullish(),
});

/**
 * Reads the extra fields of an `ip_in_use` refusal (`exitIp`, `sessions`). What
 * the backend did not say is left out: the dialog then words the refusal in
 * general terms.
 */
export function readSharedIpConflict(
  extra: Record<string, unknown>,
): SharedIpConflict {
  const parsed = conflictSchema.safeParse(extra);
  if (!parsed.success) return { exitIp: null, names: [] };
  return {
    exitIp: parsed.data.exitIp ?? null,
    names: (parsed.data.sessions ?? []).map((session) => session.name),
  };
}
