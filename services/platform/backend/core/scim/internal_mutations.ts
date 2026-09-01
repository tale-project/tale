// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

interface ActivationPlan {
  role: string;
  /** Role to persist as the restore point for a future reactivation. */
  restoreRole: string;
}

/**
 * Decide the member role for an `active` flag without clobbering a role an
 * admin set manually: an already-active member keeps its role; a reactivated
 * member is restored to its last active role (or the default).
 */
export function planActivation(
  active: boolean,
  currentRole: string | undefined,
  defaultRole: string,
  lastActiveRole: string | undefined,
): ActivationPlan {
  const current = (currentRole ?? '').toLowerCase();
  if (!active) {
    const restore =
      current && current !== 'disabled'
        ? current
        : (lastActiveRole ?? defaultRole);
    return { role: 'disabled', restoreRole: restore };
  }
  if (!current || current === 'disabled') {
    const role = lastActiveRole ?? defaultRole;
    return { role, restoreRole: role };
  }
  return { role: current, restoreRole: current };
}

/**
 * Classify how a SCIM create may touch a user already matched globally by
 * email, given that user's full membership set and the token's org. A SCIM
 * token must never graft a membership onto, or rename, an account another
 * tenant owns — `owned-elsewhere` is rejected by the create path (#2036).
 */
export function classifyUserOwnership(
  memberships: readonly { organizationId: string }[],
  organizationId: string,
): 'owned-here' | 'unowned' | 'owned-elsewhere' {
  if (memberships.some((m) => m.organizationId === organizationId)) {
    return 'owned-here';
  }
  return memberships.length > 0 ? 'owned-elsewhere' : 'unowned';
}

/**
 * Decide how an HTTP DELETE resolves for a SCIM User, from the caller's
 * membership in the token's org: a missing membership is a 404; the org owner
 * is protected (removing it would orphan the org); anything else is removed.
 */
export function classifyDeprovision(
  member: { role?: string } | undefined,
): 'not-found' | 'owner-protected' | 'deprovision' {
  if (!member) return 'not-found';
  if ((member.role ?? '').toLowerCase() === 'owner') return 'owner-protected';
  return 'deprovision';
}

/**
 * Compose a SCIM Group membership PATCH into the final desired user-id set: a
 * clear-all / replace base, then adds, then removes. Keeps an `add` paired with
 * a value-less `remove members` from being silently dropped (#2085[13]).
 */
export function composeDesiredMembers(
  replaceMembers: readonly string[],
  addMembers: readonly string[],
  removeMembers: readonly string[],
): string[] {
  const desired = new Set(replaceMembers);
  for (const id of addMembers) desired.add(id);
  for (const id of removeMembers) desired.delete(id);
  return [...desired];
}
