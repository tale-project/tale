/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adapter from "../adapter.js";
import type * as auth from "../auth.js";
import type * as entra_team_sync_add_team_member from "../entra_team_sync/add_team_member.js";
import type * as entra_team_sync_create_team from "../entra_team_sync/create_team.js";
import type * as entra_team_sync_fetch_entra_groups from "../entra_team_sync/fetch_entra_groups.js";
import type * as entra_team_sync_find_team_by_name from "../entra_team_sync/find_team_by_name.js";
import type * as entra_team_sync_get_organization_id from "../entra_team_sync/get_organization_id.js";
import type * as entra_team_sync_is_team_member from "../entra_team_sync/is_team_member.js";
import type * as entra_team_sync_map_entra_role_to_platform_role from "../entra_team_sync/map_entra_role_to_platform_role.js";
import type * as entra_team_sync_remove_stale_team_memberships from "../entra_team_sync/remove_stale_team_memberships.js";
import type * as entra_team_sync_sync_teams_from_groups from "../entra_team_sync/sync_teams_from_groups.js";
import type * as entra_team_sync_types from "../entra_team_sync/types.js";
import type * as generated_schema from "../generated_schema.js";
import type * as trusted_headers_create_session_for_trusted_user from "../trusted_headers/create_session_for_trusted_user.js";
import type * as trusted_headers_find_or_create_user_from_headers from "../trusted_headers/find_or_create_user_from_headers.js";
import type * as trusted_headers_get_user_by_id from "../trusted_headers/get_user_by_id.js";
import type * as trusted_headers_index from "../trusted_headers/index.js";
import type * as trusted_headers_resolve_team_names from "../trusted_headers/resolve_team_names.js";
import type * as trusted_headers_trusted_headers_authenticate from "../trusted_headers/trusted_headers_authenticate.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { anyApi, componentsGeneric } from "convex/server";

const fullApi: ApiFromModules<{
  adapter: typeof adapter;
  auth: typeof auth;
  "entra_team_sync/add_team_member": typeof entra_team_sync_add_team_member;
  "entra_team_sync/create_team": typeof entra_team_sync_create_team;
  "entra_team_sync/fetch_entra_groups": typeof entra_team_sync_fetch_entra_groups;
  "entra_team_sync/find_team_by_name": typeof entra_team_sync_find_team_by_name;
  "entra_team_sync/get_organization_id": typeof entra_team_sync_get_organization_id;
  "entra_team_sync/is_team_member": typeof entra_team_sync_is_team_member;
  "entra_team_sync/map_entra_role_to_platform_role": typeof entra_team_sync_map_entra_role_to_platform_role;
  "entra_team_sync/remove_stale_team_memberships": typeof entra_team_sync_remove_stale_team_memberships;
  "entra_team_sync/sync_teams_from_groups": typeof entra_team_sync_sync_teams_from_groups;
  "entra_team_sync/types": typeof entra_team_sync_types;
  generated_schema: typeof generated_schema;
  "trusted_headers/create_session_for_trusted_user": typeof trusted_headers_create_session_for_trusted_user;
  "trusted_headers/find_or_create_user_from_headers": typeof trusted_headers_find_or_create_user_from_headers;
  "trusted_headers/get_user_by_id": typeof trusted_headers_get_user_by_id;
  "trusted_headers/index": typeof trusted_headers_index;
  "trusted_headers/resolve_team_names": typeof trusted_headers_resolve_team_names;
  "trusted_headers/trusted_headers_authenticate": typeof trusted_headers_trusted_headers_authenticate;
}> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any;

export const components = componentsGeneric() as unknown as {};
