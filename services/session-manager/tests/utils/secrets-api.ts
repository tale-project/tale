// The Secrets section's side of the fake API: the secrets and the sessions the
// section starts with, and a fake of the secrets API that remembers what was
// written, so a test can add, change and delete, and read the list again as the
// page would.

import {
  secretCreateSchema,
  secretUpdateSchema,
  type Secret,
  type SecretField,
  type SecretSummary,
  type Session,
  type SessionRef,
} from '@/lib/api/schemas';

import { answer, failure, installFakeApi, listFor } from './fake-api';
import { meta, secret, session, sessionRef } from './fixtures';

export function field(
  label: string,
  value: string,
  hidden = false,
): SecretField {
  return { label, value, hidden };
}

/** What the list endpoint returns of a secret: never a field. */
export function summaryOf(stored: Secret): SecretSummary {
  const { fields: _fields, createdAt: _createdAt, ...summary } = stored;
  return summary;
}

/** The secrets the list tests read: one of each kind, two for a session. */
export const SAMPLE = {
  note: secret({
    id: 8,
    kind: 'note',
    title: 'Wi-Fi at the office',
    preview: 'Network: Studio-5G',
    updatedAt: '2026-11-01T09:55:00+00:00',
    fields: [
      field('Note', 'Network: Studio-5G\nGuests use the guest network.'),
    ],
  }),
  card: secret({
    id: 7,
    kind: 'card',
    title: 'Visa ending 4242',
    session: sessionRef({ id: 3, name: '0003', status: 'running' }),
    preview: '•••• 4242 · Ada Lovelace · 08/29',
    updatedAt: '2026-11-01T08:30:00+00:00',
    fields: [
      field('Cardholder', 'Ada Lovelace'),
      field('Card number', '4242 4242 4242 4242', true),
      field('Expiry', '08/29'),
      field('CVC', '123', true),
    ],
  }),
  credentials: secret({
    id: 6,
    kind: 'credentials',
    title: 'Example shop',
    preview: 'https://shop.example.com · ada@example.com',
    updatedAt: '2026-11-01T06:30:00+00:00',
    fields: [
      field('Website', 'https://shop.example.com'),
      field('Username', 'ada@example.com'),
      field('Password', 'correct horse battery staple', true),
    ],
  }),
  personal: secret({
    id: 5,
    kind: 'personal',
    title: 'My details',
    preview: 'Ada Lovelace · ada@example.com',
    updatedAt: '2026-10-30T10:00:00+00:00',
    fields: [
      field('Name', 'Ada Lovelace'),
      field('Email', 'ada@example.com'),
      field('Address', 'Unter den Linden 1\n10117 Berlin'),
    ],
  }),
  mail: secret({
    id: 3,
    kind: 'credentials',
    title: 'Mail',
    session: sessionRef({ id: 3, name: '0003', status: 'running' }),
    preview: 'https://mail.example.net · ada',
    updatedAt: '2026-10-12T10:00:00+00:00',
    fields: [
      field('Website', 'https://mail.example.net'),
      field('Username', 'ada'),
      field('Password', 'swordfish', true),
    ],
  }),
  bank: secret({
    id: 4,
    kind: 'credentials',
    title: 'Bank',
    session: sessionRef({ id: 12, name: 'Shop EU', status: 'stopped' }),
    preview: 'https://bank.example.org · a.lovelace',
    updatedAt: '2026-10-20T10:00:00+00:00',
    fields: [
      field('Website', 'https://bank.example.org'),
      field('Username', 'a.lovelace'),
      field('Password', 'hunter2', true),
      field('Backup code', '8814-2290-6613', true),
    ],
  }),
};

/** Newest first, as the server lists them. */
export function allSecrets(): Secret[] {
  return [
    SAMPLE.note,
    SAMPLE.card,
    SAMPLE.credentials,
    SAMPLE.personal,
    SAMPLE.bank,
    SAMPLE.mail,
  ];
}

export function sessionList(): Session[] {
  return [
    session({ id: 14, name: '0014' }),
    session({ id: 13, name: '0013' }),
    session({ id: 12, name: 'Shop EU' }),
    session({ id: 3, name: '0003', status: 'running' }),
    session({ id: 2, name: '0002' }),
    session({ id: 1, name: '0001' }),
  ];
}

interface SecretsApiOptions {
  secrets?: Secret[];
  sessions?: Session[];
  /** The number of sessions there are, when more than `sessions` holds. */
  sessionsTotal?: number;
}

/** What the server masks without being told: a value the form did not decide. */
const PRIVATE = /pass|card number|cvc|secret|token|pin/i;

/**
 * The secrets API over a list the test owns: `state.secrets` is what the
 * server holds, newest first. Writes change it; a failing route is replaced
 * with `api.on(...)`.
 */
export function installSecretsApi(options: SecretsApiOptions = {}) {
  const state = {
    secrets: [...(options.secrets ?? allSecrets())],
    sessions: options.sessions ?? sessionList(),
  };
  const refOf = (sessionId: number | null | undefined): SessionRef | null => {
    if (sessionId === null || sessionId === undefined) return null;
    const found = state.sessions.find((entry) => entry.id === sessionId);
    return {
      id: sessionId,
      name: found?.name ?? String(sessionId),
      status: 'stopped',
    };
  };
  const api = installFakeApi({
    'GET /meta': () =>
      meta({
        counts: {
          secrets: state.secrets.length,
          sessions: state.sessions.length,
        },
      }),
    'GET /sessions': ({ query }) =>
      listFor(
        query,
        state.sessions,
        options.sessionsTotal ?? state.sessions.length,
      ),
    'GET /secrets': () => state.secrets.map(summaryOf),
    'GET /secrets/:id': ({ params }) => {
      const found = state.secrets.find(
        (entry) => entry.id === Number(params.id),
      );
      return found ?? failure(404, 'secret_not_found');
    },
    'POST /secrets': ({ body }) => {
      const input = secretCreateSchema.parse(body);
      const fields = input.fields.map((entry) => ({
        label: entry.label,
        value: entry.value,
        hidden: entry.hidden ?? PRIVATE.test(entry.label),
      }));
      const created = secret({
        id: Math.max(0, ...state.secrets.map((entry) => entry.id)) + 1,
        kind: input.kind,
        title: input.title,
        session: refOf(input.sessionId),
        fields,
        preview: fields
          .filter((entry) => !entry.hidden)
          .map((entry) => entry.value)
          .join(' · '),
      });
      state.secrets = [created, ...state.secrets];
      return answer({ status: 201, body: created });
    },
    'PATCH /secrets/:id': ({ params, body }) => {
      const changes = secretUpdateSchema.parse(body);
      const found = state.secrets.find(
        (entry) => entry.id === Number(params.id),
      );
      if (found === undefined) return failure(404, 'secret_not_found');
      const updated: Secret = {
        ...found,
        ...(changes.title === undefined ? {} : { title: changes.title }),
        ...('sessionId' in changes
          ? { session: refOf(changes.sessionId) }
          : {}),
        ...(changes.fields === undefined
          ? {}
          : {
              fields: changes.fields.map((entry) => ({
                label: entry.label,
                value: entry.value,
                hidden: entry.hidden ?? PRIVATE.test(entry.label),
              })),
            }),
      };
      state.secrets = state.secrets.map((entry) =>
        entry.id === updated.id ? updated : entry,
      );
      return updated;
    },
    'DELETE /secrets/:id': ({ params }) => {
      const found = state.secrets.some(
        (entry) => entry.id === Number(params.id),
      );
      if (!found) return failure(404, 'secret_not_found');
      state.secrets = state.secrets.filter(
        (entry) => entry.id !== Number(params.id),
      );
      return answer({ status: 204 });
    },
  });
  return { api, state };
}
