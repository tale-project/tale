import type { ApiKeyOwnerChoice } from '../components/api-key-owner-field';
import type { ApiKeyRole } from '../types';

/** What the dialog knows of this organization's model endpoints: whether it
 * turned them on, and whether the viewer may call them. */
export interface ModelApiStanding {
  enabled: boolean;
  mayCall: boolean;
}

/** The roles that call the model endpoints by their role alone. */
const CALLING_ROLES: ReadonlySet<string> = new Set([
  'owner',
  'admin',
  'developer',
]);

export type ModelApiNote =
  | { messageKey: 'apiKeys.form.modelApi.disabled' }
  | { messageKey: 'apiKeys.form.modelApi.forbiddenSelf' }
  | { messageKey: 'apiKeys.form.modelApi.needsGrant'; name: string }
  | { messageKey: 'apiKeys.form.modelApi.forbiddenRole' };

/**
 * Why the key being made cannot call this organization's model endpoints,
 * or null when it can — or when that is not known yet: before the
 * organization's standing answered, or before a member is picked. Nothing
 * calls them until the organization turns them on. Then an Owner, Admin or
 * Developer calls them by role, and anyone else only with the Call models
 * over the API competence: a member's key with its member's, which this
 * dialog does not see, so it says what it takes; a key that is not a person
 * never, since no competence is granted to it, unless it acts as a
 * Developer or an Admin.
 */
export function modelApiNote(args: {
  standing: ModelApiStanding | undefined;
  owner: ApiKeyOwnerChoice;
  role: ApiKeyRole;
  member: { name: string; role: string } | null;
}): ModelApiNote | null {
  const { standing } = args;
  if (standing === undefined) return null;
  if (!standing.enabled)
    return { messageKey: 'apiKeys.form.modelApi.disabled' };
  switch (args.owner) {
    case 'self':
      return standing.mayCall
        ? null
        : { messageKey: 'apiKeys.form.modelApi.forbiddenSelf' };
    case 'member':
      return args.member === null ||
        CALLING_ROLES.has(args.member.role.toLowerCase())
        ? null
        : {
            messageKey: 'apiKeys.form.modelApi.needsGrant',
            name: args.member.name,
          };
    default:
      return CALLING_ROLES.has(args.role)
        ? null
        : { messageKey: 'apiKeys.form.modelApi.forbiddenRole' };
  }
}
