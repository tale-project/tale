import type { AssignableActor } from '../hooks/use-actor-directory';

/**
 * A member as the task surfaces list them. It lives apart from the actor
 * directory's hooks, which tests replace with stand-ins: a surface that maps
 * the members it found keeps this one.
 */
export function memberActor(
  member: {
    userId: string;
    displayName: string | undefined;
    email: string | undefined;
    role: string;
  },
  formerMember: string,
): AssignableActor {
  return {
    type: 'user',
    id: member.userId,
    // An account that holds no name and no e-mail names nobody, as on the
    // automation pages; its id would tell a reader nothing either.
    name: member.displayName || member.email || formerMember,
    email: member.email,
    role: member.role,
  };
}
