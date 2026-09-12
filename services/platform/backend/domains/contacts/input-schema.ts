import { z } from 'zod';

import { dataSourceSchema } from '../../../lib/shared/schemas/common.ts';
import { boundedJsonObject } from '../../../lib/shared/utils/json-bounds.ts';

/**
 * The ONE shape of a contact write, shared by the REST door and the app
 * door, capped at the lengths the directory stores. The REST door composes
 * it strict (an unknown key is a client mistake the door names — the
 * documented `INVALID_BODY` — never a field dropped in silence); the app
 * door composes it with its own source rule and the strip policy its
 * adapters rely on. `externalId` also takes a whole number inside the
 * IEEE-754 safe range (stored as text): a 64-bit source id sent as a JSON
 * number used to be rounded by `JSON.parse` and filed under a neighbouring
 * id.
 *
 * Every free-text field is trimmed, and `email` is stored lowercase so a
 * duplicate matches case-insensitively — the normalization the directory
 * always applied, now in the shape both doors and the OpenAPI document
 * read. Every optional field takes `null` to clear it (the one clearing
 * rule the reference documents); `address` and `metadata` are bounded
 * free-form objects.
 */

export const CONTACT_NAME_MAX = 300;
export const CONTACT_EMAIL_MAX = 320;
/** RFC 5321 §4.5.3.1.1: the part before `@` is at most 64 octets. */
export const CONTACT_EMAIL_LOCAL_PART_MAX = 64;
export const CONTACT_PHONE_MAX = 50;
export const CONTACT_EXTERNAL_ID_MAX = 256;
export const CONTACT_LOCALE_MAX = 20;
export const CONTACT_TAG_MAX = 60;
export const CONTACT_TAGS_MAX = 50;
export const CONTACT_NOTES_MAX = 10_000;

export const contactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(CONTACT_EMAIL_MAX)
  .email()
  .refine(
    (value) => value.indexOf('@') <= CONTACT_EMAIL_LOCAL_PART_MAX,
    `the part before "@" must be at most ${CONTACT_EMAIL_LOCAL_PART_MAX} characters`,
  );

/** A blank string where a client means "none" (`email: ""` from a CSV-shaped
 * source) reads as the field left out, not as a malformed value. */
const blankAsAbsent = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const contactFieldsShape = {
  name: z.string().trim().max(CONTACT_NAME_MAX).nullable().optional(),
  email: z.preprocess(blankAsAbsent, contactEmailSchema.nullable().optional()),
  phone: z.preprocess(
    blankAsAbsent,
    z.string().trim().max(CONTACT_PHONE_MAX).nullable().optional(),
  ),
  externalId: z
    .union([z.string().trim().max(CONTACT_EXTERNAL_ID_MAX), z.int()])
    .nullable()
    .optional(),
  source: dataSourceSchema.optional(),
  locale: z.string().trim().max(CONTACT_LOCALE_MAX).nullable().optional(),
  address: boundedJsonObject().nullable().optional(),
  tags: z
    .array(z.string().trim().max(CONTACT_TAG_MAX))
    .max(CONTACT_TAGS_MAX)
    .nullable()
    .optional(),
  metadata: boundedJsonObject().nullable().optional(),
  notes: z.string().trim().max(CONTACT_NOTES_MAX).nullable().optional(),
};

/** The REST door's shape: every field optional, unknown keys refused. */
export const contactFieldsSchema = z.object(contactFieldsShape).strict();

export type ContactFields = z.infer<typeof contactFieldsSchema>;

/** Whether an identity field carries a value (not unset, cleared or blank). */
const present = (value: string | number | null | undefined): boolean =>
  value !== undefined && value !== null && value !== '';

/** A create needs something to file the contact under: a body whose every
 * key is misspelled used to mint a nameless, mailless, id-less row that no
 * query could find again. */
export const contactCreateSchema = contactFieldsSchema.refine(
  (value) =>
    present(value.name) || present(value.email) || present(value.externalId),
  {
    message: 'at least one of name, email or externalId is required',
    path: ['name'],
  },
);

/** A bulk row is a create: it needs something to file the contact under,
 * and the per-row duplicate check keys on whichever of email and externalId
 * it carries. */
export const contactBulkItemSchema = contactCreateSchema;

/** The external id as the directory stores it (text): `null` clears it,
 * `undefined` leaves it alone. */
export function contactExternalIdText(
  value: string | number | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
}
