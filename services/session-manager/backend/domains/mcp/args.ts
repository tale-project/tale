// Arguments that several tools take, worded once.

import { z } from 'zod';

import { sessionNameSchema } from '../../../lib/api/schemas.ts';

/**
 * A session's name ("0001") or its id. A number is an id, always; a text is a
 * name first (digits that are no session's name are an id): see `sessionIdOf`.
 */
export const sessionRef = z
  .union([sessionNameSchema, z.int()])
  .describe(
    "The session's name (such as 0001) or its id. A number is an id; a text is a name first, and an id only if no session has that name.",
  );

/** A tab of the session; without one the tool acts on the active tab. */
export const tabId = z
  .int()
  .nullish()
  .describe('The id of a tab (see list_tabs); the active tab without one.');

/** A position in the viewport, as a screenshot shows it. */
export const pixel = z.int();

/** An element of a page that `read_page` numbered. */
export const elementNumber = z
  .int()
  .nullish()
  .describe('The number of an element that read_page gave.');

export const pressEnter = z
  .boolean()
  .default(false)
  .describe('Press Enter afterwards.');
