/**
 * What one member lookup (`GET /api/app/members/lookup`, MEMBER-R11) may
 * name — imported by both the server's route schema
 * (`backend/domains/members/routes.ts`) and the app's batcher
 * (`app/lib/backend/member-lookup-batch.ts`), so the app splits its asks
 * where the server would refuse them, instead of failing a whole batch on
 * a 400.
 */

/** How many user ids and handles, together, one lookup may name. */
export const MEMBER_LOOKUP_LIMIT = 100;

/** The longest user id or handle a lookup takes. */
export const MEMBER_LOOKUP_VALUE_MAX_LENGTH = 100;
