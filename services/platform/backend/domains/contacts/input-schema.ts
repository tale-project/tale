import { z } from 'zod';

import { dataSourceSchema } from '../../../lib/shared/schemas/common.ts';

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
 */

export const CONTACT_NAME_MAX = 300;
export const CONTACT_EMAIL_MAX = 320;
export const CONTACT_PHONE_MAX = 50;
export const CONTACT_EXTERNAL_ID_MAX = 256;
export const CONTACT_LOCALE_MAX = 20;
export const CONTACT_TAG_MAX = 60;
export const CONTACT_TAGS_MAX = 50;
export const CONTACT_NOTES_MAX = 10_000;

export const contactEmailSchema = z.string().email().max(CONTACT_EMAIL_MAX);

/** A blank string where a client means "none" (`email: ""` from a CSV-shaped
 * source) reads as the field left out, not as a malformed value. */
const blankAsAbsent = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export const contactFieldsShape = {
  name: z.string().max(CONTACT_NAME_MAX).optional(),
  email: z.preprocess(blankAsAbsent, contactEmailSchema.optional()),
  phone: z.preprocess(
    blankAsAbsent,
    z.string().max(CONTACT_PHONE_MAX).optional(),
  ),
  externalId: z
    .union([z.string().max(CONTACT_EXTERNAL_ID_MAX), z.int()])
    .optional(),
  source: dataSourceSchema.optional(),
  locale: z.string().max(CONTACT_LOCALE_MAX).optional(),
  address: z.record(z.string(), z.unknown()).optional(),
  tags: z
    .array(z.string().max(CONTACT_TAG_MAX))
    .max(CONTACT_TAGS_MAX)
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().max(CONTACT_NOTES_MAX).optional(),
};

/** The REST door's shape: every field optional, unknown keys refused. */
export const contactFieldsSchema = z.object(contactFieldsShape).strict();

export type ContactFields = z.infer<typeof contactFieldsSchema>;

/** A create needs something to file the contact under: a body whose every
 * key is misspelled used to mint a nameless, mailless, id-less row that no
 * query could find again. */
export const contactCreateSchema = contactFieldsSchema.refine(
  (value) =>
    (value.name !== undefined && value.name.trim() !== '') ||
    (value.email !== undefined && value.email !== '') ||
    value.externalId !== undefined,
  {
    message: 'at least one of name, email or externalId is required',
    path: ['name'],
  },
);

/** A bulk row is a create: it needs something to file the contact under,
 * and the per-row duplicate check keys on whichever of email and externalId
 * it carries. */
export const contactBulkItemSchema = contactCreateSchema;

/** The external id as the directory stores it (text), or undefined. */
export function contactExternalIdText(
  value: string | number | undefined,
): string | undefined {
  return value === undefined ? undefined : String(value);
}
