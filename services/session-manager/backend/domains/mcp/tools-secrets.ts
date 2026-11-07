// Secrets and notes. They are confidential: lists never show a masked value,
// `get_secret` does (one secret at a time), and `type_secret` puts a value in
// a page without ever returning it.

import { z } from 'zod';

import {
  secretFieldsSchema,
  secretKindSchema,
  secretLabelSchema,
  secretTitleSchema,
} from '../../../lib/api/schemas.ts';
import { casefold } from '../../lib/casefold.ts';
import { act, typeInto } from './acting.ts';
import { elementNumber, pressEnter, sessionRef } from './args.ts';
import { remoteOf, sessionIdOf } from './lookup.ts';
import { DESTRUCTIVE, READ_ONLY, ToolError, defineTool, json } from './tool.ts';
import { paced } from './waiting.ts';

const secretId = z.int().describe('The id of the secret (see list_secrets).');

/** What a list says of who may use a secret. */
function scopeOf(secret: { session: { name: string } | null }): string {
  return secret.session === null ? 'all sessions' : secret.session.name;
}

const listSecrets = defineTool({
  name: 'list_secrets',
  group: 'secrets',
  title: 'List secrets',
  description:
    'Secrets without their masked values (passwords, card numbers): personal information, credentials, credit cards and notes. Give a session to list the ones that session can use (its own, and with include_global the ones for every session); without one, all of them.',
  input: z.strictObject({
    kind: secretKindSchema.nullish().describe('Only secrets of this kind.'),
    session: sessionRef
      .nullish()
      .describe('Only the secrets this session can use.'),
    include_global: z
      .boolean()
      .default(true)
      .describe('With a session: also the secrets that are for every session.'),
  }),
  annotations: READ_ONLY,
  routes: ['GET /secrets'],
  async run({ kind, session, include_global }, { manager }) {
    const secrets = manager.listSecrets({
      kind: kind ?? null,
      scope: session == null ? 'all' : sessionIdOf(manager, session),
      includeGlobal: include_global,
    });
    return json(
      secrets.map((secret) => ({
        id: secret.id,
        kind: secret.kind,
        title: secret.title,
        scope: scopeOf(secret),
        preview: secret.preview,
      })),
    );
  },
});

const getSecret = defineTool({
  name: 'get_secret',
  group: 'secrets',
  title: 'Get a secret',
  description:
    'A secret with all of its values, including passwords and card numbers. To enter one into a page, use type_secret, which does not show it to you.',
  input: z.strictObject({ secret_id: secretId }),
  // Not READ_ONLY: it returns passwords and card numbers, and a client that
  // runs the read-only tools without asking would hand them over unasked.
  routes: ['GET /secrets/:id'],
  async run({ secret_id }, { manager }) {
    const secret = manager.getSecret(secret_id);
    return json({
      id: secret.id,
      kind: secret.kind,
      title: secret.title,
      scope: scopeOf(secret),
      fields: secret.fields.map((field) => ({
        label: field.label,
        value: field.value,
      })),
    });
  },
});

const typeSecret = defineTool({
  name: 'type_secret',
  group: 'secrets',
  title: 'Type a secret',
  description:
    "Type one value of a secret into a page without showing the value to you. `field` is the label of the value (Password, Card number, Email...); `occurrence` picks among values with the same label (the 2nd Email). `element` is the field's number from read_page; without one it goes where the focus is. A secret of one session can only be typed in that session.",
  input: z.strictObject({
    session: sessionRef,
    secret_id: secretId,
    field: secretLabelSchema.describe(
      'The label of the value (Password, Card number, Email...).',
    ),
    element: elementNumber,
    occurrence: z
      .int()
      .default(1)
      .describe('Which of several values with that label (1 is the first).'),
    submit: pressEnter,
  }),
  routes: ['POST /sessions/:id/type'],
  async run(
    { session, secret_id, field, element, occurrence, submit },
    context,
  ) {
    const { manager } = context;
    const sessionId = sessionIdOf(manager, session);
    const secret = manager.getSecret(secret_id);
    if (secret.session !== null && secret.session.id !== sessionId) {
      throw new ToolError(
        `“${secret.title}” belongs to session ${secret.session.name}, not to this one.`,
      );
    }
    const wanted = casefold(field.trim());
    const matching = secret.fields.filter(
      (candidate) => casefold(candidate.label) === wanted,
    );
    const [first] = matching;
    if (first === undefined) {
      const labels = secret.fields
        .map((candidate) => candidate.label)
        .join(', ');
      throw new ToolError(
        `“${secret.title}” has no value “${field}”. It has: ${labels}.`,
      );
    }
    const value = matching[occurrence - 1];
    if (value === undefined) {
      throw new ToolError(
        `“${secret.title}” has ${matching.length} value(s) named ${first.label}.`,
      );
    }
    const browser = remoteOf(manager, session);
    const notice = await act(
      browser,
      typeInto(browser, value.value, element, submit),
      paced(context, 300),
    );
    // The answer names the value; it never has it.
    return `Typed the ${first.label} of “${secret.title}”.${notice}`;
  },
});

const createSecret = defineTool({
  name: 'create_secret',
  group: 'secrets',
  title: 'Create a secret',
  description:
    'Store a secret. `fields` are label and value pairs: personal information has Name, Email, Phone, Address, Company, Company address (more can be added); credentials Website, Username, Password; credit cards Cardholder, Card number, Expiry, CVC; a note has one field, Note. Passwords, card numbers and CVCs are masked in the web page automatically. Without a session the secret is for every session.',
  input: z.strictObject({
    kind: secretKindSchema,
    title: secretTitleSchema.describe('What the secret is called.'),
    fields: secretFieldsSchema.describe('Label and value pairs.'),
    session: sessionRef
      .nullish()
      .describe('The session that may use it; every session without one.'),
  }),
  routes: ['POST /secrets'],
  async run({ kind, title, fields, session }, { manager }) {
    const created = manager.createSecret({
      kind,
      title,
      fields,
      sessionId: session == null ? null : sessionIdOf(manager, session),
    });
    return json({
      id: created.id,
      title: created.title,
      preview: created.preview,
    });
  },
});

const updateSecret = defineTool({
  name: 'update_secret',
  group: 'secrets',
  title: 'Update a secret',
  description:
    "Change a secret: what is given replaces what was there (`fields` replaces all of its values). Give a session to make it that session's own, or `for_every_session` to make it available to all.",
  input: z.strictObject({
    secret_id: secretId,
    title: secretTitleSchema.nullish().describe('The new title.'),
    fields: secretFieldsSchema
      .nullish()
      .describe('The new label and value pairs: all of them.'),
    session: sessionRef
      .nullish()
      .describe('Make it the secret of this session.'),
    for_every_session: z
      .boolean()
      .default(false)
      .describe('Make it a secret for every session.'),
  }),
  routes: ['PATCH /secrets/:id'],
  async run(
    { secret_id, title, fields, session, for_every_session },
    { manager },
  ) {
    let scope: 'keep' | 'global' | number = 'keep';
    if (for_every_session) scope = 'global';
    else if (session != null) scope = sessionIdOf(manager, session);
    const updated = manager.updateSecret(secret_id, {
      title: title ?? undefined,
      fields: fields ?? undefined,
      session: scope,
    });
    return json({
      id: updated.id,
      title: updated.title,
      preview: updated.preview,
    });
  },
});

const deleteSecret = defineTool({
  name: 'delete_secret',
  group: 'secrets',
  title: 'Delete a secret',
  description: 'Delete a secret for good.',
  input: z.strictObject({ secret_id: secretId }),
  annotations: DESTRUCTIVE,
  routes: ['DELETE /secrets/:id'],
  async run({ secret_id }, { manager }) {
    manager.deleteSecret(secret_id);
    return `Deleted secret ${secret_id}.`;
  },
});

export const secretTools = [
  listSecrets,
  getSecret,
  typeSecret,
  createSecret,
  updateSecret,
  deleteSecret,
];
