/**
 * Static SCIM discovery documents (RFC 7643 §5–7): ServiceProviderConfig,
 * ResourceTypes, and Schemas. IdP setup wizards probe these to learn what the
 * endpoint supports.
 */

import {
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_USER_SCHEMA,
} from './types';

const SPC_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig';
const RESOURCE_TYPE_SCHEMA =
  'urn:ietf:params:scim:schemas:core:2.0:ResourceType';
const SCHEMA_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Schema';

export function serviceProviderConfig(): unknown {
  return {
    schemas: [SPC_SCHEMA],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    // We support the `attr eq "value"` filter IdPs use during sync.
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Authentication via a SCIM bearer token.',
        primary: true,
      },
    ],
    meta: { resourceType: 'ServiceProviderConfig' },
  };
}

export function resourceTypes(baseUrl?: string): unknown {
  const types = [
    {
      schemas: [RESOURCE_TYPE_SCHEMA],
      id: 'User',
      name: 'User',
      endpoint: '/Users',
      description: 'User Account',
      schema: SCIM_USER_SCHEMA,
      meta: {
        resourceType: 'ResourceType',
        ...(baseUrl ? { location: `${baseUrl}/ResourceTypes/User` } : {}),
      },
    },
    {
      schemas: [RESOURCE_TYPE_SCHEMA],
      id: 'Group',
      name: 'Group',
      endpoint: '/Groups',
      description: 'Group',
      schema: SCIM_GROUP_SCHEMA,
      meta: {
        resourceType: 'ResourceType',
        ...(baseUrl ? { location: `${baseUrl}/ResourceTypes/Group` } : {}),
      },
    },
  ];
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: types.length,
    startIndex: 1,
    itemsPerPage: types.length,
    Resources: types,
  };
}

function attr(
  name: string,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    type,
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: 'readWrite',
    returned: 'default',
    uniqueness: 'none',
    ...extra,
  };
}

function userSchema(): unknown {
  return {
    schemas: [SCHEMA_SCHEMA],
    id: SCIM_USER_SCHEMA,
    name: 'User',
    description: 'User Account',
    attributes: [
      attr('userName', 'string', { required: true, uniqueness: 'server' }),
      attr('displayName', 'string'),
      {
        ...attr('name', 'complex'),
        subAttributes: [
          attr('givenName', 'string'),
          attr('familyName', 'string'),
          attr('formatted', 'string'),
        ],
      },
      {
        ...attr('emails', 'complex'),
        multiValued: true,
        subAttributes: [
          attr('value', 'string'),
          attr('primary', 'boolean'),
          attr('type', 'string'),
        ],
      },
      attr('active', 'boolean'),
    ],
    meta: { resourceType: 'Schema' },
  };
}

function groupSchema(): unknown {
  return {
    schemas: [SCHEMA_SCHEMA],
    id: SCIM_GROUP_SCHEMA,
    name: 'Group',
    description: 'Group',
    attributes: [
      attr('displayName', 'string', { required: true }),
      {
        ...attr('members', 'complex'),
        multiValued: true,
        subAttributes: [attr('value', 'string'), attr('display', 'string')],
      },
    ],
    meta: { resourceType: 'Schema' },
  };
}

export function schemas(): unknown {
  const all = [userSchema(), groupSchema()];
  return {
    schemas: [SCIM_LIST_RESPONSE_SCHEMA],
    totalResults: all.length,
    startIndex: 1,
    itemsPerPage: all.length,
    Resources: all,
  };
}
