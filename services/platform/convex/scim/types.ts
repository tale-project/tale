/**
 * SCIM 2.0 (RFC 7643/7644) types: the wire resources we emit, the internal
 * records our queries return, and the normalized PATCH shapes our mappers
 * produce. Kept dependency-free so `mappers.ts` stays pure and unit-testable.
 */

export const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST_RESPONSE_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_PATCH_OP_SCHEMA =
  'urn:ietf:params:scim:api:messages:2.0:PatchOp';

// ---------------------------------------------------------------------------
// Wire resources (what we serialize back to the IdP)
// ---------------------------------------------------------------------------

export interface ScimMeta {
  resourceType: 'User' | 'Group';
  created?: string;
  lastModified?: string;
  location?: string;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  displayName?: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: { value: string; primary?: boolean; type?: string }[];
  active: boolean;
  meta: ScimMeta;
}

export interface ScimGroupResource {
  schemas: string[];
  id: string;
  externalId?: string;
  displayName: string;
  members: { value: string; display?: string }[];
  meta: ScimMeta;
}

export type ScimResource = ScimUserResource | ScimGroupResource;

// ---------------------------------------------------------------------------
// Internal records (what our queries/mutations return for mapping)
// ---------------------------------------------------------------------------

export interface ScimUserRecord {
  userId: string;
  email: string;
  name: string;
  active: boolean;
  externalId?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ScimGroupRecord {
  teamId: string;
  displayName: string;
  memberUserIds: string[];
  externalId?: string;
  createdAt?: number;
  updatedAt?: number;
}

// ---------------------------------------------------------------------------
// Normalized PATCH results (mapper output, applied by the mutations)
// ---------------------------------------------------------------------------

export interface UserPatch {
  active?: boolean;
  displayName?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
}

export interface GroupPatch {
  displayName?: string;
  addMembers: string[];
  removeMembers: string[];
  /** When set, replace the entire membership set with exactly these ids. */
  replaceMembers?: string[];
}

// Raw incoming PATCH operation, before normalization.
export interface ScimPatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}
