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
import type * as generated_schema from "../generated_schema.js";
import type * as sso_team_sync from "../sso/team_sync.js";
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
  generated_schema: typeof generated_schema;
  "sso/team_sync": typeof sso_team_sync;
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
