/**
 * What one member lookup (`GET /api/app/members/lookup`, MEMBER-R11) may
 * name, and what one member search (`GET /api/app/members/search`,
 * MEMBER-R12) may match — imported by both the server's route schemas
 * (`backend/domains/members/routes.ts`) and the app's reads
 * (`app/lib/backend/member-lookup-batch.ts`, the search row of
 * `app/lib/backend/settings.ts`), so the app asks only what the server
 * takes, instead of failing a read on a 400.
 */

/** How many user ids and handles, together, one lookup may name. */
export const MEMBER_LOOKUP_LIMIT = 100;

/** The longest user id or handle a lookup takes. */
export const MEMBER_LOOKUP_VALUE_MAX_LENGTH = 100;

/** The longest text a member search matches. */
export const MEMBER_SEARCH_QUERY_MAX_LENGTH = 200;
